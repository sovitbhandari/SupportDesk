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
import playgroundRoutes from "./routes/playgroundRoutes.js";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { ticketNotificationsQueue } from "./lib/queues.js";
import { allowRoles } from "./middleware/rbac.js";
import { requireAuth } from "./middleware/auth.js";
import { handleStream } from "./routes/streamRoutes.js";
import { config } from "./config.js";
import { pool } from "./lib/db.js";
import { redis } from "./lib/redis.js";

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

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    await redis.ping();
    return res.status(200).json({ status: "ok", db: "ok", redis: "ok" });
  } catch {
    return res.status(503).json({ status: "degraded", db: "error", redis: "error" });
  }
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
app.use("/api/playground", playgroundRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  return res.status(500).json({ error: "InternalServerError", message: err.message });
});

app.use((_req, res) => {
  return res.status(404).json({ error: "Route not found" });
});

export default app;
