import crypto from "node:crypto";
import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "../lib/types.js";
import { log, userHash } from "../lib/logger.js";
import { recordRequest } from "../lib/metrics.js";

export function requestContext(req: AuthedRequest, res: Response, next: NextFunction) {
  const requestId =
    typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].trim()
      ? req.headers["x-request-id"].slice(0, 128)
      : crypto.randomUUID();
  const start = process.hrtime.bigint();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    recordRequest(res.statusCode, durationMs);
    log("info", "http_request_completed", {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      user: userHash(req.auth?.userId),
      role: req.auth?.role ?? null
    });
  });

  next();
}
