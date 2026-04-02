import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validation.js";
import type { AuthedRequest } from "../lib/types.js";

const router = Router();

const updateProfileSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional()
});

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8)
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `
    SELECT id, organization_id, email, full_name, is_active, created_at, updated_at
    FROM users
    WHERE id = $1 AND organization_id = $2
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

  if (req.body.fullName !== undefined) {
    fields.push(`full_name = $${idx++}`);
    values.push(req.body.fullName);
  }

  if (req.body.email !== undefined) {
    fields.push(`email = $${idx++}`);
    values.push(req.body.email);
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
      RETURNING id, organization_id, email, full_name, is_active, created_at, updated_at
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

router.patch(
  "/me/password",
  requireAuth,
  validate("body", updatePasswordSchema),
  async (req: AuthedRequest, res) => {
    const current = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1",
      [req.auth?.userId, req.auth?.organizationId]
    );

    if (current.rowCount !== 1) {
      return res.status(404).json({ error: "Profile not found" });
    }

    if (current.rows[0].password_hash !== req.body.currentPassword) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    await pool.query(
      "UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 AND organization_id = $3",
      [req.body.newPassword, req.auth?.userId, req.auth?.organizationId]
    );

    return res.status(200).json({ message: "Password updated" });
  }
);

export default router;
