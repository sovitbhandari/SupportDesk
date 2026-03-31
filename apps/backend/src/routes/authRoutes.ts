import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { signToken } from "../middleware/auth.js";
import type { AuthedRequest } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validation.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
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

  if (user.password_hash !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken({
    userId: user.id,
    organizationId: user.organization_id,
    role: user.role,
    email: user.email
  });

  return res.status(200).json({
    token,
    user: {
      id: user.id,
      organizationId: user.organization_id,
      role: user.role,
      email: user.email
    }
  });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  return res.status(200).json({ user: req.auth });
});

export default router;
