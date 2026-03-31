import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { allowRoles } from "../middleware/rbac.js";
import { validate } from "../lib/validation.js";
import type { AuthedRequest } from "../lib/types.js";
import { ticketNotificationsQueue } from "../lib/queues.js";
import { publishMessageEvent } from "../lib/events.js";

const router = Router();

const ticketIdParamsSchema = z.object({ id: z.string().uuid() });

const ticketCreateSchema = z.object({
  subject: z.string().min(3),
  description: z.string().min(5),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium")
});

const ticketUpdateSchema = z.object({
  subject: z.string().min(3).optional(),
  description: z.string().min(5).optional(),
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional()
});

const messageCreateSchema = z.object({
  body: z.string().min(1)
});

const assignmentSchema = z.object({
  agentId: z.string().uuid()
});

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `
    SELECT id, organization_id, requester_id, subject, description, status, priority, created_at, updated_at
    FROM tickets
    WHERE organization_id = $1
    ORDER BY created_at DESC
    `,
    [req.auth?.organizationId]
  );

  return res.status(200).json({ data: result.rows });
});

router.get("/:id", requireAuth, validate("params", ticketIdParamsSchema), async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `
    SELECT id, organization_id, requester_id, subject, description, status, priority, created_at, updated_at
    FROM tickets
    WHERE id = $1 AND organization_id = $2
    LIMIT 1
    `,
    [req.params.id, req.auth?.organizationId]
  );

  if (result.rowCount !== 1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  return res.status(200).json({ data: result.rows[0] });
});

router.post("/", requireAuth, validate("body", ticketCreateSchema), async (req: AuthedRequest, res) => {
  const requesterId = req.auth?.userId;
  const result = await pool.query(
    `
    INSERT INTO tickets(organization_id, requester_id, subject, description, status, priority)
    VALUES ($1, $2, $3, $4, 'open', $5)
    RETURNING id, organization_id, requester_id, subject, description, status, priority, created_at, updated_at
    `,
    [req.auth?.organizationId, requesterId, req.body.subject, req.body.description, req.body.priority]
  );

  const ticket = result.rows[0] as {
    id: string;
    organization_id: string;
    requester_id: string;
    subject: string;
    created_at: string;
  };

  // Queue email notification asynchronously; API response is not blocked.
  void ticketNotificationsQueue
    .add("ticket-created-email", {
      ticketId: ticket.id,
      organizationId: ticket.organization_id,
      requesterId: ticket.requester_id,
      subject: ticket.subject
    })
    .catch((error: Error) => {
      console.error("Failed to enqueue ticket notification job:", error.message);
    });

  return res.status(201).json({ data: result.rows[0] });
});

router.patch("/:id", requireAuth, validate("params", ticketIdParamsSchema), validate("body", ticketUpdateSchema), async (req: AuthedRequest, res) => {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, column] of [
    ["subject", "subject"],
    ["description", "description"],
    ["status", "status"],
    ["priority", "priority"]
  ] as const) {
    if (req.body[key] !== undefined) {
      fields.push(`${column} = $${idx++}`);
      values.push(req.body[key]);
    }
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No valid fields provided" });
  }

  values.push(req.params.id, req.auth?.organizationId);

  const result = await pool.query(
    `
    UPDATE tickets
    SET ${fields.join(", ")}, updated_at = now()
    WHERE id = $${idx++} AND organization_id = $${idx}
    RETURNING id, organization_id, requester_id, subject, description, status, priority, created_at, updated_at
    `,
    values
  );

  if (result.rowCount !== 1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  return res.status(200).json({ data: result.rows[0] });
});

router.delete("/:id", requireAuth, allowRoles("admin"), validate("params", ticketIdParamsSchema), async (req: AuthedRequest, res) => {
  const result = await pool.query("DELETE FROM tickets WHERE id = $1 AND organization_id = $2", [
    req.params.id,
    req.auth?.organizationId
  ]);

  if (result.rowCount !== 1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  return res.status(200).json({ message: "Ticket deleted" });
});

router.get("/:id/messages", requireAuth, validate("params", ticketIdParamsSchema), async (req: AuthedRequest, res) => {
  const ticket = await pool.query("SELECT id FROM tickets WHERE id = $1 AND organization_id = $2", [
    req.params.id,
    req.auth?.organizationId
  ]);
  if (ticket.rowCount !== 1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const result = await pool.query(
    `
    SELECT id, organization_id, ticket_id, author_id, body, created_at
    FROM messages
    WHERE ticket_id = $1 AND organization_id = $2
    ORDER BY created_at ASC
    `,
    [req.params.id, req.auth?.organizationId]
  );

  return res.status(200).json({ data: result.rows });
});

router.post(
  "/:id/messages",
  requireAuth,
  validate("params", ticketIdParamsSchema),
  validate("body", messageCreateSchema),
  async (req: AuthedRequest, res) => {
    const ticket = await pool.query("SELECT id FROM tickets WHERE id = $1 AND organization_id = $2", [
      req.params.id,
      req.auth?.organizationId
    ]);
    if (ticket.rowCount !== 1) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const result = await pool.query(
      `
      INSERT INTO messages(organization_id, ticket_id, author_id, body)
      VALUES($1, $2, $3, $4)
      RETURNING id, organization_id, ticket_id, author_id, body, created_at
      `,
      [req.auth?.organizationId, req.params.id, req.auth?.userId, req.body.body]
    );

    const message = result.rows[0] as {
      ticket_id: string;
      organization_id: string;
      author_id: string;
      body: string;
      created_at: string;
    };

    if (req.auth?.role === "agent" || req.auth?.role === "admin") {
      const requesterResult = await pool.query(
        "SELECT requester_id FROM tickets WHERE id = $1 AND organization_id = $2 LIMIT 1",
        [req.params.id, req.auth?.organizationId]
      );
      const requesterId = requesterResult.rows[0]?.requester_id as string | undefined;
      if (requesterId) {
        void publishMessageEvent({
          type: "ticket.message.created",
          ticketId: message.ticket_id,
          organizationId: message.organization_id,
          senderId: message.author_id,
          recipientUserId: requesterId,
          body: message.body,
          createdAt: message.created_at
        });
      }
    }

    return res.status(201).json({ data: result.rows[0] });
  }
);

router.post(
  "/:id/assign",
  requireAuth,
  allowRoles("admin", "agent"),
  validate("params", ticketIdParamsSchema),
  validate("body", assignmentSchema),
  async (req: AuthedRequest, res) => {
    const targetAgent = await pool.query(
      `
      SELECT u.id
      FROM users u
      JOIN organization_memberships om ON om.user_id = u.id
      JOIN roles r ON r.id = om.role_id
      WHERE u.id = $1 AND u.organization_id = $2 AND r.key = 'agent'
      LIMIT 1
      `,
      [req.body.agentId, req.auth?.organizationId]
    );

    if (targetAgent.rowCount !== 1) {
      return res.status(404).json({ error: "Agent not found in your organization" });
    }

    const ticket = await pool.query("SELECT id FROM tickets WHERE id = $1 AND organization_id = $2", [
      req.params.id,
      req.auth?.organizationId
    ]);
    if (ticket.rowCount !== 1) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const result = await pool.query(
      `
      INSERT INTO ticket_assignments(organization_id, ticket_id, agent_id)
      VALUES($1, $2, $3)
      RETURNING id, organization_id, ticket_id, agent_id, assigned_at, released_at
      `,
      [req.auth?.organizationId, req.params.id, req.body.agentId]
    );

    return res.status(201).json({ data: result.rows[0] });
  }
);

router.delete(
  "/:id/assign",
  requireAuth,
  allowRoles("admin", "agent"),
  validate("params", ticketIdParamsSchema),
  async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `
      UPDATE ticket_assignments
      SET released_at = now()
      WHERE ticket_id = $1
        AND organization_id = $2
        AND released_at IS NULL
      RETURNING id
      `,
      [req.params.id, req.auth?.organizationId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Active assignment not found" });
    }

    return res.status(200).json({ message: "Assignment released" });
  }
);

export default router;
