import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import type { AuthedRequest } from "../lib/types.js";
import { messageChannel, type TicketMessageEvent } from "../lib/events.js";
import { redisSubscriber } from "../lib/redis.js";

const router = Router();
const clients = new Map<string, Set<Response>>();
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
        client.write(data);
      }
    } catch {
      // ignore malformed events
    }
  });

  isSubscribed = true;
}

export const handleStream = async (req: AuthedRequest, res: Response) => {
  const userId = req.auth?.userId;
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

  clients.get(userId)?.add(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    const userClients = clients.get(userId);
    userClients?.delete(res);
    if (userClients && userClients.size === 0) {
      clients.delete(userId);
    }
  });
};

router.get("/", requireAuth, handleStream);
router.get("", requireAuth, handleStream);

export default router;
