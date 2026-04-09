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
  agentId: z.string().uuid().optional()
});

async function getTicketAccessContext(ticketId: string, organizationId: string) {
  const result = await pool.query(
    `
    SELECT
      t.id,
      t.requester_id,
      (
        SELECT ta.agent_id
        FROM ticket_assignments ta
        WHERE ta.ticket_id = t.id
          AND ta.organization_id = t.organization_id
          AND ta.released_at IS NULL
        ORDER BY ta.assigned_at DESC
        LIMIT 1
      ) AS active_assignment_agent_id
    FROM tickets t
    WHERE t.id = $1 AND t.organization_id = $2
    LIMIT 1
    `,
    [ticketId, organizationId]
  );

  return result.rows[0] as
    | { id: string; requester_id: string; active_assignment_agent_id: string | null }
    | undefined;
}

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const assignedTo = typeof req.query.assigned_to === "string" ? req.query.assigned_to : undefined;
  const unassignedOnly = req.query.unassigned === "true";
  const where: string[] = ["t.organization_id = $1"];
  const values: unknown[] = [req.auth?.organizationId];
  let idx = 2;

  if (status) {
    where.push(`t.status = $${idx++}`);
    values.push(status);
  }
  if (assignedTo === "me") {
    where.push(`EXISTS (\n      SELECT 1 FROM ticket_assignments ta\n      WHERE ta.ticket_id = t.id\n        AND ta.organization_id = t.organization_id\n        AND ta.released_at IS NULL\n        AND ta.agent_id = $${idx}\n    )`);
    values.push(req.auth?.userId);
    idx += 1;
  }
  if (unassignedOnly) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM ticket_assignments ta
      WHERE ta.ticket_id = t.id
        AND ta.organization_id = t.organization_id
        AND ta.released_at IS NULL
    )`);
  }
  if (req.auth?.role === "agent" && assignedTo !== "me" && !unassignedOnly) {
    // Default agent view is "my assigned tickets".
    where.push(`EXISTS (
      SELECT 1 FROM ticket_assignments ta
      WHERE ta.ticket_id = t.id
        AND ta.organization_id = t.organization_id
        AND ta.released_at IS NULL
        AND ta.agent_id = $${idx}
    )`);
    values.push(req.auth.userId);
    idx += 1;
  }
  if (req.auth?.role === "customer") {
    where.push(`t.requester_id = $${idx}`);
    values.push(req.auth.userId);
    idx += 1;
  }

  const result = await pool.query(
    `
    SELECT
      t.id, t.organization_id, t.requester_id, t.subject, t.description, t.status, t.priority, t.created_at, t.updated_at,
      (
        SELECT ta.agent_id
        FROM ticket_assignments ta
        WHERE ta.ticket_id = t.id
          AND ta.organization_id = t.organization_id
          AND ta.released_at IS NULL
        ORDER BY ta.assigned_at DESC
        LIMIT 1
      ) AS active_assignment_agent_id
    FROM tickets t
    WHERE ${where.join(" AND ")}
    ORDER BY t.created_at DESC
    `,
    values
  );

  return res.status(200).json({ data: result.rows });
});

router.get("/:id", requireAuth, validate("params", ticketIdParamsSchema), async (req: AuthedRequest, res) => {
  const where: string[] = ["t.id = $1", "t.organization_id = $2"];
  const values: unknown[] = [req.params.id, req.auth?.organizationId];
  if (req.auth?.role === "customer") {
    where.push("t.requester_id = $3");
    values.push(req.auth.userId);
  }

  const result = await pool.query(
    `
    SELECT
      t.id, t.organization_id, t.requester_id, t.subject, t.description, t.status, t.priority, t.created_at, t.updated_at,
      (
        SELECT ta.agent_id
        FROM ticket_assignments ta
        WHERE ta.ticket_id = t.id
          AND ta.organization_id = t.organization_id
          AND ta.released_at IS NULL
        ORDER BY ta.assigned_at DESC
        LIMIT 1
      ) AS active_assignment_agent_id
    FROM tickets t
    WHERE ${where.join(" AND ")}
    LIMIT 1
    `,
    values
  );

  if (result.rowCount !== 1) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  if (
    req.auth?.role === "agent" &&
    result.rows[0].active_assignment_agent_id !== req.auth.userId
  ) {
    return res.status(403).json({ error: "Forbidden" });
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
    .then(async () => {
      await pool.query(
        `INSERT INTO notification_jobs(organization_id, type, payload, status, attempts) VALUES($1, $2, $3::jsonb, 'queued', 0)`,
        [
          ticket.organization_id,
          "ticket-created",
          JSON.stringify({
            ticketId: ticket.id,
            requesterId: ticket.requester_id,
            subject: ticket.subject
          })
        ]
      );
    })
    .catch((error: Error) => {
      console.error("Failed to enqueue ticket notification job:", error.message);
    });

  return res.status(201).json({ data: result.rows[0] });
});

router.patch("/:id", requireAuth, validate("params", ticketIdParamsSchema), validate("body", ticketUpdateSchema), async (req: AuthedRequest, res) => {
  const ticketId = String(req.params.id);
  const ticket = await getTicketAccessContext(ticketId, req.auth?.organizationId as string);
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  if (req.auth?.role === "customer") {
    return res.status(403).json({ error: "Customers cannot update tickets directly" });
  }
  if (req.auth?.role === "agent" && ticket.active_assignment_agent_id !== req.auth.userId) {
    return res.status(403).json({ error: "Agents can only update their assigned tickets" });
  }

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
  const ticketId = String(req.params.id);
  const ticket = await getTicketAccessContext(ticketId, req.auth?.organizationId as string);
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  if (req.auth?.role === "customer" && ticket.requester_id !== req.auth.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (req.auth?.role === "agent" && ticket.active_assignment_agent_id !== req.auth.userId) {
    return res.status(403).json({ error: "Forbidden" });
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
    const ticketId = String(req.params.id);
    const ticket = await getTicketAccessContext(ticketId, req.auth?.organizationId as string);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    if (req.auth?.role === "customer" && ticket.requester_id !== req.auth.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (req.auth?.role === "agent" && ticket.active_assignment_agent_id !== req.auth.userId) {
      return res.status(403).json({ error: "Forbidden" });
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
      id: string;
      ticket_id: string;
      organization_id: string;
      author_id: string;
      body: string;
      created_at: string;
    };

    const recipientUserId =
      req.auth?.role === "customer" ? ticket.active_assignment_agent_id : ticket.requester_id;
    if (recipientUserId) {
      void publishMessageEvent({
        type: "ticket.message.created",
        messageId: message.id,
        ticketId: message.ticket_id,
        organizationId: message.organization_id,
        senderId: message.author_id,
        recipientUserId,
        body: message.body,
        createdAt: message.created_at
      });
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
    const targetAgentId =
      req.auth?.role === "agent" ? req.auth.userId : req.body.agentId;
    if (!targetAgentId) {
      return res.status(400).json({ error: "agentId is required for admin assignment" });
    }

    const targetAgent = await pool.query(
      `
      SELECT u.id
      FROM users u
      JOIN organization_memberships om ON om.user_id = u.id
      JOIN roles r ON r.id = om.role_id
      WHERE u.id = $1 AND u.organization_id = $2 AND r.key = 'agent'
      LIMIT 1
      `,
      [targetAgentId, req.auth?.organizationId]
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

    const activeAssignment = await pool.query(
      `
      SELECT id, agent_id FROM ticket_assignments
      WHERE ticket_id = $1 AND organization_id = $2 AND released_at IS NULL
      LIMIT 1
      `,
      [req.params.id, req.auth?.organizationId]
    );
    if (activeAssignment.rowCount !== 0) {
      const current = activeAssignment.rows[0];
      if (req.auth?.role === "admin") {
        // Admin manual assignment can reassign by closing current assignment.
        await pool.query(
          "UPDATE ticket_assignments SET released_at = now() WHERE id = $1",
          [current.id]
        );
      } else {
        return res.status(409).json({ error: "Ticket already assigned" });
      }
    }

    const result = await pool.query(
      `
      INSERT INTO ticket_assignments(organization_id, ticket_id, agent_id)
      VALUES($1, $2, $3)
      RETURNING id, organization_id, ticket_id, agent_id, assigned_at, released_at
      `,
      [req.auth?.organizationId, req.params.id, targetAgentId]
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
    const query =
      req.auth?.role === "agent"
        ? `
      UPDATE ticket_assignments
      SET released_at = now()
      WHERE ticket_id = $1
        AND organization_id = $2
        AND released_at IS NULL
        AND agent_id = $3
      RETURNING id
      `
        : `
      UPDATE ticket_assignments
      SET released_at = now()
      WHERE ticket_id = $1
        AND organization_id = $2
        AND released_at IS NULL
      RETURNING id
      `;
    const values =
      req.auth?.role === "agent"
        ? [req.params.id, req.auth?.organizationId, req.auth.userId]
        : [req.params.id, req.auth?.organizationId];
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Active assignment not found" });
    }

    return res.status(200).json({ message: "Assignment released" });
  }
);

export default router;
