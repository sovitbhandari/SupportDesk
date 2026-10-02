import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import type { AuthedRequest } from "../lib/types.js";
import { messageChannel, type TicketMessageEvent } from "../lib/events.js";
import { redisSubscriber } from "../lib/redis.js";
import { pool } from "../lib/db.js";

const router = Router();
type StreamClient = { res: Response; ticketId?: string };
const clients = new Map<string, Set<StreamClient>>();
let isSubscribed = false;
const maxStreamsPerUser = 5;

function parseSequence(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    return 0;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function writeSse(res: Response, event: string, data: unknown, id?: string | number) {
  const lines = [
    id !== undefined ? `id: ${id}` : null,
    `event: ${event}`,
    ...JSON.stringify(data).split("\n").map((line) => `data: ${line}`),
    "",
    ""
  ].filter((line): line is string => line !== null);
  return res.write(lines.join("\n"));
}

async function canAccessTicket(req: AuthedRequest, ticketId: string) {
  if (!req.auth) {
    return false;
  }

  const result = await pool.query(
    `
    SELECT
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
    [ticketId, req.auth.organizationId]
  );

  const ticket = result.rows[0] as
    | { requester_id: string; active_assignment_agent_id: string | null }
    | undefined;
  if (!ticket) {
    return false;
  }
  if (req.auth.role === "customer") {
    return ticket.requester_id === req.auth.userId;
  }
  if (req.auth.role === "agent") {
    return ticket.active_assignment_agent_id === req.auth.userId;
  }
  return req.auth.role === "admin";
}

async function replayTicketEvents(req: AuthedRequest, res: Response, ticketId: string, afterSequence: number) {
  const result = await pool.query(
    `
    SELECT
      te.id AS event_id,
      te.sequence,
      m.id AS message_id,
      m.organization_id,
      m.ticket_id,
      m.author_id,
      m.body,
      m.created_at
    FROM ticket_events te
    JOIN messages m
      ON m.id = te.message_id
      AND m.organization_id = te.organization_id
      AND m.ticket_id = te.ticket_id
    WHERE te.organization_id = $1
      AND te.ticket_id = $2
      AND te.event_type = 'ticket.message.created'
      AND te.sequence > $3
    ORDER BY te.sequence ASC
    LIMIT 100
    `,
    [req.auth?.organizationId, ticketId, afterSequence]
  );

  for (const row of result.rows) {
    const event: TicketMessageEvent = {
      type: "ticket.message.created",
      eventId: row.event_id,
      sequence: Number(row.sequence),
      messageId: row.message_id,
      ticketId: row.ticket_id,
      organizationId: row.organization_id,
      senderId: row.author_id,
      recipientUserId: req.auth?.userId ?? "",
      body: row.body,
      createdAt: row.created_at
    };
    if (!writeSse(res, event.type, event, event.sequence)) {
      res.end();
      return;
    }
  }
}

async function ensureSubscribed() {
  if (isSubscribed) {
    return;
  }

  await redisSubscriber.subscribe(messageChannel);
  redisSubscriber.on("message", (_channel: string, payload: string) => {
    try {
      const event = JSON.parse(payload) as TicketMessageEvent;
      const targets = clients.get(event.recipientUserId);
      if (!targets || targets.size === 0) {
        return;
      }

      for (const client of targets) {
        if (!client.ticketId || client.ticketId === event.ticketId) {
          if (!writeSse(client.res, event.type, event, event.sequence)) {
            client.res.end();
          }
        }
      }
    } catch {
      // ignore malformed events
    }
  });

  isSubscribed = true;
}

export const handleStream = async (req: AuthedRequest, res: Response) => {
  const userId = req.auth?.userId;
  const ticketId = typeof req.params.ticketId === "string" ? req.params.ticketId : undefined;
  if (!userId) {
    return res.status(401).json({ error: "Unauthenticated" });
  }
  if (ticketId && !(await canAccessTicket(req, ticketId))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await ensureSubscribed();

  const userClients = clients.get(userId);
  if (userClients && userClients.size >= maxStreamsPerUser) {
    return res.status(429).json({ error: "Too many open streams" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }

  const entry: StreamClient = { res, ticketId };
  clients.get(userId)?.add(entry);
  writeSse(res, "connected", { userId, ticketId });

  if (ticketId) {
    const afterSequence = parseSequence(req.query.lastEventId ?? req.headers["last-event-id"]);
    await replayTicketEvents(req, res, ticketId, afterSequence);
  }

  const heartbeat = setInterval(() => {
    writeSse(res, "heartbeat", Date.now());
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    const userClients = clients.get(userId);
    userClients?.delete(entry);
    if (userClients && userClients.size === 0) {
      clients.delete(userId);
    }
  });
};

router.get("/", requireAuth, handleStream);
router.get("/tickets/:ticketId/stream", requireAuth, handleStream);

export default router;
