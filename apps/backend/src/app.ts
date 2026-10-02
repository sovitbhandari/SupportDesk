import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes.js";
import organizationRoutes from "./routes/organizationRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import ticketRoutes from "./routes/ticketRoutes.js";
import streamRoutes from "./routes/streamRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { ticketNotificationsQueue } from "./lib/queues.js";
import { allowRoles } from "./middleware/rbac.js";
import { requireAuth } from "./middleware/auth.js";
import { requestContext } from "./middleware/requestContext.js";
import { handleStream } from "./routes/streamRoutes.js";
import { config } from "./config.js";
import { appPool, pool } from "./lib/db.js";
import { redis } from "./lib/redis.js";
import { snapshotRequestMetrics } from "./lib/metrics.js";
import { safeError } from "./lib/logger.js";

const app = express();
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/api/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(ticketNotificationsQueue)],
  serverAdapter
});

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(requestContext);

app.get("/health", async (_req, res) => {
  return res.status(200).json({ status: "ok" });
});

app.get("/readyz", async (_req, res) => {
  const dependencies: Record<string, "ok" | "error"> = {
    ownerDb: "error",
    appDb: "error",
    redis: "error"
  };
  const errors: Record<string, string> = {};

  try {
    await pool.query("SELECT 1");
    dependencies.ownerDb = "ok";
  } catch (error) {
    errors.ownerDb = safeError(error);
  }

  try {
    await appPool.query("SELECT 1");
    dependencies.appDb = "ok";
  } catch (error) {
    errors.appDb = safeError(error);
  }

  try {
    await redis.ping();
    dependencies.redis = "ok";
  } catch (error) {
    errors.redis = safeError(error);
  }

  const ready = Object.values(dependencies).every((status) => status === "ok");
  return res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "degraded",
    dependencies,
    errors
  });
});

app.get("/metrics", async (_req, res) => {
  const metrics: Record<string, unknown> = snapshotRequestMetrics();
  try {
    metrics.queue = await ticketNotificationsQueue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed"
    );
  } catch (error) {
    metrics.queue = { error: safeError(error) };
  }

  try {
    const outbox = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('pending', 'failed'))::int AS backlog,
        COALESCE(
          EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status IN ('pending', 'failed')))),
          0
        )::int AS oldest_age_seconds,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM outbox_events
      `
    );
    metrics.outbox = outbox.rows[0];
  } catch (error) {
    metrics.outbox = { error: safeError(error) };
  }

  return res.status(200).json(metrics);
});

app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/stream", streamRoutes);
app.get("/api/tickets/:ticketId/stream", requireAuth, handleStream);
app.use("/api/profile", profileRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/queues", requireAuth, allowRoles("admin"), serverAdapter.getRouter());

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  return res.status(500).json({
    error: "InternalServerError",
    message: err.message,
    requestId: res.locals.requestId
  });
});

app.use((_req, res) => {
  return res.status(404).json({ error: "Route not found" });
});

export default app;
