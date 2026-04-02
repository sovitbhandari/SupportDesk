import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import type { AuthedRequest } from "../lib/types.js";
import { messageChannel, type TicketMessageEvent } from "../lib/events.js";
import { redisSubscriber } from "../lib/redis.js";

const router = Router();
type StreamClient = { res: Response; ticketId?: string };
const clients = new Map<string, Set<StreamClient>>();
let isSubscribed = false;

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

      const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const client of targets) {
        if (!client.ticketId || client.ticketId === event.ticketId) {
          client.res.write(data);
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

  await ensureSubscribed();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }

  const entry: StreamClient = { res, ticketId };
  clients.get(userId)?.add(entry);
  res.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
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
router.get("", requireAuth, handleStream);
router.get("/tickets/:ticketId/stream", requireAuth, handleStream);

export default router;
