import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/authRoutes.js";
import organizationRoutes from "./routes/organizationRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import ticketRoutes from "./routes/ticketRoutes.js";
import streamRoutes from "./routes/streamRoutes.js";
import { requireAuth } from "./middleware/auth.js";
import { handleStream } from "./routes/streamRoutes.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  return res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/stream", streamRoutes);
app.get("/api/stream", requireAuth, handleStream);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  return res.status(500).json({ error: "InternalServerError", message: err.message });
});

app.use((_req, res) => {
  return res.status(404).json({ error: "Route not found" });
});

export default app;
