import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { allowRoles } from "../middleware/rbac.js";
import { validate } from "../lib/validation.js";
import type { AuthedRequest } from "../lib/types.js";

const router = Router();

const agentIdParams = z.object({ id: z.string().uuid() });
const employeeParams = z.object({ id: z.string().uuid() });
const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  temporaryPassword: z.string().min(8).optional()
});
const updateEmployeeSchema = z.object({
  role: z.enum(["admin", "agent", "customer"]).optional(),
  isActive: z.boolean().optional()
});

router.get("/agents", requireAuth, allowRoles("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `
    SELECT
      u.id,
      u.email,
      u.full_name,
      u.is_active,
      COUNT(t.id)::int AS ticket_count
    FROM users u
    JOIN organization_memberships om ON om.user_id = u.id
    JOIN roles r ON r.id = om.role_id
    LEFT JOIN ticket_assignments ta
      ON ta.agent_id = u.id
      AND ta.organization_id = u.organization_id
      AND ta.released_at IS NULL
    LEFT JOIN tickets t ON t.id = ta.ticket_id
    WHERE u.organization_id = $1
      AND r.key = 'agent'
    GROUP BY u.id
    ORDER BY u.created_at DESC
    `,
    [req.auth?.organizationId]
  );

  return res.status(200).json({ data: result.rows });
});

router.post("/agents/invite", requireAuth, allowRoles("admin"), validate("body", inviteSchema), async (req: AuthedRequest, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(req.body.temporaryPassword ?? "TempPass123!", 10);

    const user = await client.query(
      `
      INSERT INTO users(organization_id, email, full_name, password_hash)
      VALUES($1, $2, $3, $4)
      RETURNING id, email, full_name, is_active
      `,
      [req.auth?.organizationId, req.body.email, req.body.fullName, passwordHash]
    );

    const role = await client.query("SELECT id FROM roles WHERE key = 'agent' LIMIT 1");
    await client.query(
      "INSERT INTO organization_memberships(organization_id, user_id, role_id) VALUES($1, $2, $3)",
      [req.auth?.organizationId, user.rows[0].id, role.rows[0].id]
    );

    await client.query("COMMIT");
    return res.status(201).json({ data: user.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      return res.status(409).json({ error: "Agent email already exists" });
    }
    return res.status(400).json({ error: "Failed to invite agent" });
  } finally {
    client.release();
  }
});

router.delete("/agents/:id", requireAuth, allowRoles("admin"), validate("params", agentIdParams), async (req: AuthedRequest, res) => {
  const result = await pool.query(
    "UPDATE users SET is_active = false, updated_at = now() WHERE id = $1 AND organization_id = $2 RETURNING id",
    [req.params.id, req.auth?.organizationId]
  );

  if (result.rowCount !== 1) {
    return res.status(404).json({ error: "Agent not found" });
  }

  return res.status(204).send();
});

router.get("/employees", requireAuth, allowRoles("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `
    SELECT u.id, u.email, u.full_name, u.is_active, r.key AS role, u.created_at
    FROM users u
    JOIN organization_memberships om ON om.user_id = u.id
    JOIN roles r ON r.id = om.role_id
    WHERE u.organization_id = $1
    ORDER BY u.created_at DESC
    `,
    [req.auth?.organizationId]
  );
  return res.status(200).json({ data: result.rows });
});

router.patch(
  "/employees/:id",
  requireAuth,
  allowRoles("admin"),
  validate("params", employeeParams),
  validate("body", updateEmployeeSchema),
  async (req: AuthedRequest, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const targetEmployee = await client.query(
        `
        SELECT u.id, u.is_active, r.key AS role
        FROM users u
        JOIN organization_memberships om ON om.user_id = u.id
        JOIN roles r ON r.id = om.role_id
        WHERE u.id = $1 AND u.organization_id = $2
        LIMIT 1
        `,
        [req.params.id, req.auth?.organizationId]
      );

      if (targetEmployee.rowCount !== 1) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Employee not found" });
      }

      const current = targetEmployee.rows[0] as { id: string; is_active: boolean; role: "admin" | "agent" | "customer" };
      const isSelf = req.auth?.userId === req.params.id;
      const isAdminBeingDemoted = current.role === "admin" && req.body.role !== undefined && req.body.role !== "admin";
      const isAdminBeingDeactivated = current.role === "admin" && req.body.isActive === false;

      if (isSelf && (isAdminBeingDemoted || isAdminBeingDeactivated)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "You cannot remove your own admin access" });
      }

      if (isAdminBeingDemoted || isAdminBeingDeactivated) {
        const adminCount = await client.query(
          `
          SELECT COUNT(*)::int AS active_admins
          FROM users u
          JOIN organization_memberships om ON om.user_id = u.id
          JOIN roles r ON r.id = om.role_id
          WHERE u.organization_id = $1
            AND u.is_active = true
            AND r.key = 'admin'
          `,
          [req.auth?.organizationId]
        );

        if (Number(adminCount.rows[0]?.active_admins ?? 0) <= 1) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "At least one active admin is required" });
        }
      }

      if (req.body.isActive !== undefined) {
        await client.query(
          "UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2 AND organization_id = $3",
          [req.body.isActive, req.params.id, req.auth?.organizationId]
        );
      }

      if (req.body.role !== undefined) {
        const role = await client.query("SELECT id FROM roles WHERE key = $1 LIMIT 1", [req.body.role]);
        if (role.rowCount !== 1) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Invalid role" });
        }
        await client.query(
          "UPDATE organization_memberships SET role_id = $1 WHERE user_id = $2 AND organization_id = $3",
          [role.rows[0].id, req.params.id, req.auth?.organizationId]
        );
      }

      const result = await client.query(
        `
        SELECT u.id, u.email, u.full_name, u.is_active, r.key AS role
        FROM users u
        JOIN organization_memberships om ON om.user_id = u.id
        JOIN roles r ON r.id = om.role_id
        WHERE u.id = $1 AND u.organization_id = $2
        LIMIT 1
        `,
        [req.params.id, req.auth?.organizationId]
      );

      await client.query("COMMIT");

      if (result.rowCount !== 1) {
        return res.status(404).json({ error: "Employee not found" });
      }

      return res.status(200).json({ data: result.rows[0] });
    } catch {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Failed to update employee" });
    } finally {
      client.release();
    }
  }
);

router.get("/metrics", requireAuth, allowRoles("admin"), async (req: AuthedRequest, res) => {
  const orgId = req.auth?.organizationId;
  const open = await pool.query(
    "SELECT COUNT(*)::int AS open_tickets FROM tickets WHERE organization_id = $1 AND status = 'open'",
    [orgId]
  );

  const avgResolution = await pool.query(
    `
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600), 0)::float AS avg_resolution_hours
    FROM tickets
    WHERE organization_id = $1 AND status IN ('resolved', 'closed')
    `,
    [orgId]
  );

  const perAgent = await pool.query(
    `
    SELECT u.id, u.full_name, COUNT(ta.id)::int AS assigned_count
    FROM users u
    JOIN organization_memberships om ON om.user_id = u.id
    JOIN roles r ON r.id = om.role_id
    LEFT JOIN ticket_assignments ta ON ta.agent_id = u.id AND ta.organization_id = u.organization_id
    WHERE u.organization_id = $1 AND r.key = 'agent'
    GROUP BY u.id
    ORDER BY assigned_count DESC
    `,
    [orgId]
  );

  return res.status(200).json({
    data: {
      openTickets: open.rows[0].open_tickets,
      avgResolutionHours: avgResolution.rows[0].avg_resolution_hours,
      byAgent: perAgent.rows
    }
  });
});

export default router;
