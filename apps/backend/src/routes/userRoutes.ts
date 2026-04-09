import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { allowRoles } from "../middleware/rbac.js";
import { validate } from "../lib/validation.js";
import type { AuthedRequest } from "../lib/types.js";

const router = Router();

const userParamsSchema = z.object({
  id: z.string().uuid()
});

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
  role: z.enum(["customer", "agent", "admin"])
});

const updateUserSchema = z.object({
  fullName: z.string().min(2).optional(),
  isActive: z.boolean().optional()
});

router.get("/", requireAuth, allowRoles("admin", "agent"), async (req: AuthedRequest, res) => {
  const result = await pool.query(
    "SELECT id, organization_id, email, full_name, is_active, created_at, updated_at FROM users WHERE organization_id = $1 ORDER BY created_at DESC",
    [req.auth?.organizationId]
  );

  return res.status(200).json({ data: result.rows });
});

router.get("/:id", requireAuth, allowRoles("admin", "agent"), validate("params", userParamsSchema), async (req: AuthedRequest, res) => {
  const result = await pool.query(
    "SELECT id, organization_id, email, full_name, is_active, created_at, updated_at FROM users WHERE id = $1 AND organization_id = $2",
    [req.params.id, req.auth?.organizationId]
  );

  if (result.rowCount !== 1) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.status(200).json({ data: result.rows[0] });
});

router.post("/", requireAuth, allowRoles("admin"), validate("body", createUserSchema), async (req: AuthedRequest, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(req.body.password, 10);

    const userResult = await client.query(
      `
      INSERT INTO users(organization_id, email, full_name, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING id, organization_id, email, full_name, is_active, created_at, updated_at
      `,
      [req.auth?.organizationId, req.body.email, req.body.fullName, passwordHash]
    );

    const roleResult = await client.query("SELECT id FROM roles WHERE key = $1 LIMIT 1", [req.body.role]);
    if (roleResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid role" });
    }

    await client.query(
      "INSERT INTO organization_memberships(organization_id, user_id, role_id) VALUES($1, $2, $3)",
      [req.auth?.organizationId, userResult.rows[0].id, roleResult.rows[0].id]
    );

    await client.query("COMMIT");
    return res.status(201).json({ data: userResult.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: "Failed to create user", detail: String(error) });
  } finally {
    client.release();
  }
});

router.patch(
  "/:id",
  requireAuth,
  validate("params", userParamsSchema),
  validate("body", updateUserSchema),
  async (req: AuthedRequest, res) => {
    const targetUserId = req.params.id;
    const canEdit = req.auth?.role === "admin" || req.auth?.userId === targetUserId;
    if (!canEdit) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (req.body.fullName !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(req.body.fullName);
    }

    if (req.body.isActive !== undefined) {
      if (req.auth?.role !== "admin") {
        return res.status(403).json({ error: "Only admin can change active status" });
      }
      fields.push(`is_active = $${idx++}`);
      values.push(req.body.isActive);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }

    values.push(targetUserId, req.auth?.organizationId);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(", ")}, updated_at = now() WHERE id = $${idx++} AND organization_id = $${idx} RETURNING id, organization_id, email, full_name, is_active, created_at, updated_at`,
      values
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({ data: result.rows[0] });
  }
);

export default router;
