import { Router } from "express";
import type { QueryResult, QueryResultRow } from "pg";
import { z } from "zod";
import { pool, withTenantTransaction } from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { allowRoles } from "../middleware/rbac.js";
import { validate } from "../lib/validation.js";
import type { AuthedRequest } from "../lib/types.js";
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

type Queryable = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>>;
};

function paginationLimit(rawLimit: unknown, fallback = 50, max = 100) {
  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function sequenceCursor(rawCursor: unknown) {
  if (typeof rawCursor !== "string" || rawCursor.trim() === "") {
    return 0;
  }
  const parsed = Number(rawCursor);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function getTicketAccessContext(ticketId: string, organizationId: string, client: Queryable = pool) {
  const result = await client.query(
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
  const limit = paginationLimit(req.query.limit, 50, 100);
  const cursorCreatedAt = typeof req.query.cursor_created_at === "string" ? req.query.cursor_created_at : undefined;
  const cursorId = typeof req.query.cursor_id === "string" ? req.query.cursor_id : undefined;
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
  if (cursorCreatedAt && cursorId) {
    where.push(`(t.created_at, t.id) < ($${idx++}::timestamptz, $${idx++}::uuid)`);
    values.push(cursorCreatedAt, cursorId);
  }
  values.push(limit + 1);

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
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT $${idx}
    `,
    values
  );

  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return res.status(200).json({
    data: rows,
    page: {
      limit,
      hasMore: result.rows.length > limit,
      nextCursor: last
        ? { createdAt: last.created_at, id: last.id }
        : null
    }
  });
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
  if (!req.auth) {
    return res.status(401).json({ error: "Unauthenticated" });
  }
  const auth = req.auth;

  const result = await withTenantTransaction(auth, async (client) => {
    const ticketResult = await client.query(
      `
      INSERT INTO tickets(organization_id, requester_id, subject, description, status, priority)
      VALUES ($1, $2, $3, $4, 'open', $5)
      RETURNING id, organization_id, requester_id, subject, description, status, priority, created_at, updated_at
      `,
      [auth.organizationId, auth.userId, req.body.subject, req.body.description, req.body.priority]
    );

    const ticket = ticketResult.rows[0] as {
      id: string;
      organization_id: string;
      requester_id: string;
      priority: string;
      status: string;
    };

    await client.query(
      `
      INSERT INTO outbox_events(organization_id, event_type, schema_version, aggregate_type, aggregate_id, payload)
      VALUES($1, 'ticket.created.notification_requested', 1, 'ticket', $2, $3::jsonb)
      `,
      [
        ticket.organization_id,
        ticket.id,
        JSON.stringify({
          ticketId: ticket.id,
          requesterId: ticket.requester_id
        })
      ]
    );

    await client.query(
      `
      INSERT INTO audit_logs(organization_id, actor_user_id, event_type, payload)
      VALUES($1, $2, 'ticket.created', $3::jsonb)
      `,
      [
        ticket.organization_id,
        auth.userId,
        JSON.stringify({
          ticketId: ticket.id,
          requesterId: ticket.requester_id,
          priority: ticket.priority,
          status: ticket.status
        })
      ]
    );

    return ticketResult;
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
  const limit = paginationLimit(req.query.limit, 50, 100);
  const afterSequence = sequenceCursor(req.query.after);

  const result = await pool.query(
    `
    SELECT
      m.id,
      m.organization_id,
      m.ticket_id,
      m.author_id,
      m.body,
      m.created_at,
      te.id AS event_id,
      te.sequence
    FROM ticket_events te
    JOIN messages m
      ON m.id = te.message_id
      AND m.organization_id = te.organization_id
      AND m.ticket_id = te.ticket_id
    WHERE te.ticket_id = $1
      AND te.organization_id = $2
      AND te.event_type = 'ticket.message.created'
      AND te.sequence > $3
    ORDER BY te.sequence ASC
    LIMIT $4
    `,
    [req.params.id, req.auth?.organizationId, afterSequence, limit + 1]
  );

  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return res.status(200).json({
    data: rows,
    page: {
      limit,
      hasMore: result.rows.length > limit,
      nextCursor: last ? String(last.sequence) : null
    }
  });
});

router.post(
  "/:id/messages",
  requireAuth,
  validate("params", ticketIdParamsSchema),
  validate("body", messageCreateSchema),
  async (req: AuthedRequest, res) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    const auth = req.auth;
    const ticketId = String(req.params.id);

    const result = await withTenantTransaction(auth, async (client) => {
      const ticket = await getTicketAccessContext(ticketId, auth.organizationId, client);
      if (!ticket) {
        return { status: 404, body: { error: "Ticket not found" } };
      }
      if (auth.role === "customer" && ticket.requester_id !== auth.userId) {
        return { status: 403, body: { error: "Forbidden" } };
      }
      if (auth.role === "agent" && ticket.active_assignment_agent_id !== auth.userId) {
        return { status: 403, body: { error: "Forbidden" } };
      }

      await client.query(
        "SELECT id FROM tickets WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [ticketId, auth.organizationId]
      );

      await client.query(
        `
        INSERT INTO ticket_event_counters(organization_id, ticket_id, next_sequence)
        VALUES($1, $2, 1)
        ON CONFLICT (organization_id, ticket_id) DO NOTHING
        `,
        [auth.organizationId, ticketId]
      );
      const counter = await client.query<{ sequence: number }>(
        `
        UPDATE ticket_event_counters
        SET next_sequence = next_sequence + 1,
            updated_at = now()
        WHERE organization_id = $1 AND ticket_id = $2
        RETURNING next_sequence - 1 AS sequence
        `,
        [auth.organizationId, ticketId]
      );
      const sequence = Number(counter.rows[0]?.sequence);

      const messageResult = await client.query(
        `
        INSERT INTO messages(organization_id, ticket_id, author_id, body)
        VALUES($1, $2, $3, $4)
        RETURNING id, organization_id, ticket_id, author_id, body, created_at
        `,
        [auth.organizationId, ticketId, auth.userId, req.body.body]
      );

      const message = messageResult.rows[0] as {
        id: string;
        ticket_id: string;
        organization_id: string;
        author_id: string;
        body: string;
        created_at: string;
      };

      const event = await client.query<{ id: string; sequence: number }>(
        `
        INSERT INTO ticket_events(
          organization_id, ticket_id, sequence, event_type, message_id, actor_user_id, payload
        )
        VALUES($1, $2, $3, 'ticket.message.created', $4, $5, $6::jsonb)
        RETURNING id, sequence
        `,
        [
          auth.organizationId,
          ticketId,
          sequence,
          message.id,
          auth.userId,
          JSON.stringify({ messageId: message.id, body: message.body })
        ]
      );

      const recipientUserId =
        auth.role === "customer" ? ticket.active_assignment_agent_id : ticket.requester_id;

      return {
        status: 201,
        body: { data: { ...message, event_id: event.rows[0].id, sequence: event.rows[0].sequence } },
        event:
          recipientUserId
            ? {
                type: "ticket.message.created" as const,
                eventId: event.rows[0].id,
                sequence: event.rows[0].sequence,
                messageId: message.id,
                ticketId: message.ticket_id,
                organizationId: message.organization_id,
                senderId: message.author_id,
                recipientUserId,
                body: message.body,
                createdAt: message.created_at
              }
            : null
      };
    });

    if ("event" in result && result.event) {
      void publishMessageEvent(result.event);
    }

    return res.status(result.status).json(result.body);
  }
);

router.post(
  "/:id/assign",
  requireAuth,
  allowRoles("admin", "agent"),
  validate("params", ticketIdParamsSchema),
  validate("body", assignmentSchema),
  async (req: AuthedRequest, res) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    const auth = req.auth;

    const targetAgentId =
      auth.role === "agent" ? auth.userId : req.body.agentId;
    if (!targetAgentId) {
      return res.status(400).json({ error: "agentId is required for admin assignment" });
    }

    try {
      const result = await withTenantTransaction(auth, async (client) => {
        const targetAgent = await client.query(
          `
          SELECT u.id
          FROM users u
          JOIN organization_memberships om
            ON om.user_id = u.id
            AND om.organization_id = u.organization_id
          JOIN roles r ON r.id = om.role_id
          WHERE u.id = $1 AND u.organization_id = $2 AND r.key = 'agent'
          LIMIT 1
          `,
          [targetAgentId, auth.organizationId]
        );

        if (targetAgent.rowCount !== 1) {
          return { status: 404, body: { error: "Agent not found in your organization" } };
        }

        const ticket = await client.query(
          "SELECT id FROM tickets WHERE id = $1 AND organization_id = $2 FOR UPDATE",
          [req.params.id, auth.organizationId]
        );
        if (ticket.rowCount !== 1) {
          return { status: 404, body: { error: "Ticket not found" } };
        }

        const activeAssignment = await client.query(
          `
          SELECT id, agent_id FROM ticket_assignments
          WHERE ticket_id = $1 AND organization_id = $2 AND released_at IS NULL
          LIMIT 1
          `,
          [req.params.id, auth.organizationId]
        );
        if (activeAssignment.rowCount !== 0) {
          const current = activeAssignment.rows[0];
          if (auth.role === "admin") {
            await client.query(
              "UPDATE ticket_assignments SET released_at = now() WHERE id = $1 AND organization_id = $2",
              [current.id, auth.organizationId]
            );
          } else {
            return { status: 409, body: { error: "Ticket already assigned" } };
          }
        }

        const assignment = await client.query(
          `
          INSERT INTO ticket_assignments(organization_id, ticket_id, agent_id)
          VALUES($1, $2, $3)
          RETURNING id, organization_id, ticket_id, agent_id, assigned_at, released_at
          `,
          [auth.organizationId, req.params.id, targetAgentId]
        );

        return { status: 201, body: { data: assignment.rows[0] } };
      });

      return res.status(result.status).json(result.body);
    } catch (error) {
      const pgError = error as { code?: string };
      if (pgError.code === "23505") {
        return res.status(409).json({ error: "Ticket already assigned" });
      }
      throw error;
    }
  }
);

router.delete(
  "/:id/assign",
  requireAuth,
  allowRoles("admin", "agent"),
  validate("params", ticketIdParamsSchema),
  async (req: AuthedRequest, res) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    const auth = req.auth;

    const result = await withTenantTransaction(auth, async (client) => {
      const ticket = await client.query(
        "SELECT id FROM tickets WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [req.params.id, auth.organizationId]
      );
      if (ticket.rowCount !== 1) {
        return { rowCount: 0 };
      }

      const query =
        auth.role === "agent"
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
        auth.role === "agent"
          ? [req.params.id, auth.organizationId, auth.userId]
          : [req.params.id, auth.organizationId];

      return client.query(query, values);
    });

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Active assignment not found" });
    }

    return res.status(200).json({ message: "Assignment released" });
  }
);

export default router;
