import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validation.js";
import type { AuthedRequest } from "../lib/types.js";

const router = Router();

const updateProfileSchema = z.object({
  preferredName: z.string().min(2).optional(),
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  preferredTheme: z.enum(["light", "dark"]).optional()
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `
    SELECT
      u.id,
      u.organization_id,
      u.email,
      u.full_name,
      u.preferred_name,
      u.preferred_theme,
      u.is_active,
      u.created_at,
      u.updated_at,
      o.name AS organization_name,
      o.slug AS organization_slug,
      COALESCE((
        SELECT s.created_at
        FROM sessions s
        WHERE s.user_id = u.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ), u.created_at) AS last_login_at,
      (
        SELECT s.id
        FROM sessions s
        WHERE s.user_id = u.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) AS current_session_id,
      (
        SELECT s.created_at
        FROM sessions s
        WHERE s.user_id = u.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) AS current_session_created_at,
      (
        SELECT s.ip_address
        FROM sessions s
        WHERE s.user_id = u.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) AS current_session_ip,
      (
        SELECT s.user_agent
        FROM sessions s
        WHERE s.user_id = u.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) AS current_session_user_agent
    FROM users u
    JOIN organizations o ON o.id = u.organization_id
    WHERE u.id = $1 AND u.organization_id = $2
    LIMIT 1
    `,
    [req.auth?.userId, req.auth?.organizationId]
  );

  if (result.rowCount !== 1) {
    return res.status(404).json({ error: "Profile not found" });
  }

  return res.status(200).json({ data: result.rows[0] });
});

router.patch("/me", requireAuth, validate("body", updateProfileSchema), async (req: AuthedRequest, res) => {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (req.body.preferredName !== undefined) {
    fields.push(`preferred_name = $${idx++}`);
    values.push(req.body.preferredName);
  }

  if (req.body.fullName !== undefined) {
    fields.push(`full_name = $${idx++}`);
    values.push(req.body.fullName);
  }

  if (req.body.email !== undefined) {
    fields.push(`email = $${idx++}`);
    values.push(req.body.email);
  }

  if (req.body.preferredTheme !== undefined) {
    fields.push(`preferred_theme = $${idx++}`);
    values.push(req.body.preferredTheme);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No profile fields provided" });
  }

  values.push(req.auth?.userId, req.auth?.organizationId);

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET ${fields.join(", ")}, updated_at = now()
      WHERE id = $${idx++} AND organization_id = $${idx}
      RETURNING id, organization_id, email, full_name, preferred_name, preferred_theme, is_active, created_at, updated_at
      `,
      values
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      return res.status(409).json({ error: "Email already in use" });
    }
    return res.status(400).json({ error: "Failed to update profile" });
  }
});

export default router;
