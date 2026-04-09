import crypto from "node:crypto";
import { Router } from "express";
import type { Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../lib/db.js";
import {
  requireAuth,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from "../middleware/auth.js";
import type { AuthedRequest } from "../lib/types.js";
import { validate } from "../lib/validation.js";
import { config } from "../config.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  organizationName: z.string().min(2),
  organizationSlug: z.string().regex(/^[a-z0-9-]+$/).min(2).optional()
});

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(config.refreshCookieName, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

router.post("/register", validate("body", registerSchema), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const slug = req.body.organizationSlug ?? slugify(req.body.organizationName);

    const org = await client.query(
      "INSERT INTO organizations(name, slug) VALUES($1, $2) RETURNING id, name, slug",
      [req.body.organizationName, slug]
    );

    const passwordHash = await bcrypt.hash(req.body.password, 10);

    const userResult = await client.query(
      `
      INSERT INTO users(organization_id, email, full_name, password_hash)
      VALUES($1, $2, $3, $4)
      RETURNING id, organization_id, email, full_name
      `,
      [org.rows[0].id, req.body.email, req.body.fullName, passwordHash]
    );

    const role = await client.query("SELECT id FROM roles WHERE key = 'admin' LIMIT 1");
    if (role.rowCount !== 1) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Admin role missing in database" });
    }

    await client.query(
      "INSERT INTO organization_memberships(organization_id, user_id, role_id) VALUES($1, $2, $3)",
      [org.rows[0].id, userResult.rows[0].id, role.rows[0].id]
    );

    const accessToken = signAccessToken({
      userId: userResult.rows[0].id,
      organizationId: userResult.rows[0].organization_id,
      role: "admin",
      email: userResult.rows[0].email
    });
    const refreshToken = signRefreshToken(userResult.rows[0].id);

    await client.query(
      `
      INSERT INTO sessions(user_id, refresh_token_hash, ip_address, user_agent, expires_at)
      VALUES($1, $2, $3, $4, now() + interval '7 days')
      `,
      [userResult.rows[0].id, hashToken(refreshToken), req.ip, req.headers["user-agent"] ?? null]
    );

    await client.query("COMMIT");

    setRefreshCookie(res, refreshToken);

    return res.status(201).json({
      token: accessToken,
      user: {
        id: userResult.rows[0].id,
        organizationId: userResult.rows[0].organization_id,
        role: "admin",
        email: userResult.rows[0].email
      },
      organization: org.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      return res.status(409).json({ error: "Email or organization slug already exists" });
    }
    return res.status(400).json({ error: "Failed to register account" });
  } finally {
    client.release();
  }
});

router.post("/login", validate("body", loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    `
    SELECT u.id, u.organization_id, u.email, r.key as role, u.password_hash
    FROM users u
    JOIN organization_memberships om ON om.user_id = u.id
    JOIN roles r ON r.id = om.role_id
    WHERE u.email = $1 AND u.is_active = true
    LIMIT 1
    `,
    [email]
  );

  if (result.rowCount !== 1) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const user = result.rows[0] as {
    id: string;
    organization_id: string;
    email: string;
    role: "customer" | "agent" | "admin";
    password_hash: string;
  };

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const accessToken = signAccessToken({
    userId: user.id,
    organizationId: user.organization_id,
    role: user.role,
    email: user.email
  });
  const refreshToken = signRefreshToken(user.id);

  await pool.query(
    `
    INSERT INTO sessions(user_id, refresh_token_hash, ip_address, user_agent, expires_at)
    VALUES($1, $2, $3, $4, now() + interval '7 days')
    `,
    [user.id, hashToken(refreshToken), req.ip, req.headers["user-agent"] ?? null]
  );

  setRefreshCookie(res, refreshToken);

  return res.status(200).json({
    token: accessToken,
    user: {
      id: user.id,
      organizationId: user.organization_id,
      role: user.role,
      email: user.email
    }
  });
});

router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies?.[config.refreshCookieName] as string | undefined;
  if (!refreshToken) {
    return res.status(401).json({ error: "Missing refresh token" });
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const session = await pool.query(
      `
      SELECT id, user_id
      FROM sessions
      WHERE user_id = $1
        AND refresh_token_hash = $2
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [decoded.sub, hashToken(refreshToken)]
    );

    if (session.rowCount !== 1) {
      return res.status(401).json({ error: "Refresh token invalid" });
    }

    const userResult = await pool.query(
      `
      SELECT u.id, u.organization_id, u.email, r.key as role
      FROM users u
      JOIN organization_memberships om ON om.user_id = u.id
      JOIN roles r ON r.id = om.role_id
      WHERE u.id = $1 AND u.is_active = true
      LIMIT 1
      `,
      [decoded.sub]
    );

    if (userResult.rowCount !== 1) {
      return res.status(401).json({ error: "User no longer active" });
    }

    const user = userResult.rows[0] as {
      id: string;
      organization_id: string;
      email: string;
      role: "customer" | "agent" | "admin";
    };

    const accessToken = signAccessToken({
      userId: user.id,
      organizationId: user.organization_id,
      role: user.role,
      email: user.email
    });

    return res.status(200).json({ token: accessToken });
  } catch {
    return res.status(401).json({ error: "Refresh token invalid" });
  }
});

router.post("/logout", requireAuth, async (req: AuthedRequest, res) => {
  const refreshToken = req.cookies?.[config.refreshCookieName] as string | undefined;
  if (refreshToken) {
    await pool.query(
      "DELETE FROM sessions WHERE user_id = $1 AND refresh_token_hash = $2",
      [req.auth?.userId, hashToken(refreshToken)]
    );
  }

  res.clearCookie(config.refreshCookieName, { path: "/" });
  return res.status(200).json({ message: "Logged out" });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  return res.status(200).json({ user: req.auth });
});

export default router;
