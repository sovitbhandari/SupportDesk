import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { allowRoles } from "../middleware/rbac.js";
import { validate } from "../lib/validation.js";
import type { AuthedRequest } from "../lib/types.js";

const router = Router();

const orgParamsSchema = z.object({
  id: z.string().uuid()
});

const createOrgSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/)
});

const updateOrgSchema = z.object({
  name: z.string().min(2).optional(),
  isActive: z.boolean().optional()
});

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const result = await pool.query(
    "SELECT id, name, slug, is_active, created_at, updated_at FROM organizations WHERE id = $1",
    [req.auth?.organizationId]
  );
  return res.status(200).json({ data: result.rows });
});

router.get("/:id", requireAuth, validate("params", orgParamsSchema), async (req: AuthedRequest, res) => {
  const { id } = req.params;
  if (id !== req.auth?.organizationId) {
    return res.status(403).json({ error: "Cross-tenant organization access forbidden" });
  }

  const result = await pool.query(
    "SELECT id, name, slug, is_active, created_at, updated_at FROM organizations WHERE id = $1",
    [id]
  );
  if (result.rowCount !== 1) {
    return res.status(404).json({ error: "Organization not found" });
  }

  return res.status(200).json({ data: result.rows[0] });
});

router.post("/", requireAuth, allowRoles("admin"), validate("body", createOrgSchema), async (req, res) => {
  const { name, slug } = req.body;
  const result = await pool.query(
    "INSERT INTO organizations(name, slug) VALUES($1, $2) RETURNING id, name, slug, is_active, created_at, updated_at",
    [name, slug]
  );
  return res.status(201).json({ data: result.rows[0] });
});

router.patch(
  "/:id",
  requireAuth,
  allowRoles("admin"),
  validate("params", orgParamsSchema),
  validate("body", updateOrgSchema),
  async (req: AuthedRequest, res) => {
    const { id } = req.params;
    if (id !== req.auth?.organizationId) {
      return res.status(403).json({ error: "Cross-tenant organization update forbidden" });
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (req.body.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(req.body.name);
    }
    if (req.body.isActive !== undefined) {
      fields.push(`is_active = $${i++}`);
      values.push(req.body.isActive);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE organizations SET ${fields.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING id, name, slug, is_active, created_at, updated_at`
      ,
      values
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({ error: "Organization not found" });
    }

    return res.status(200).json({ data: result.rows[0] });
  }
);

export default router;
