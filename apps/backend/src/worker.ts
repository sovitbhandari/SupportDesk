import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import nodemailer from "nodemailer";
import {
  ticketNotificationsQueue,
  ticketNotificationsQueueName,
  type OutboxNotificationJob
} from "./lib/queues.js";
import { bullmqConnection, redis } from "./lib/redis.js";
import { pool } from "./lib/db.js";
import { log, safeError } from "./lib/logger.js";

const workerId = `worker-${process.pid}-${randomUUID()}`;
const dispatchIntervalMs = Number(process.env.OUTBOX_DISPATCH_INTERVAL_MS ?? 5000);
const dispatchBatchSize = Number(process.env.OUTBOX_DISPATCH_BATCH_SIZE ?? 10);
const leaseSeconds = Number(process.env.OUTBOX_LEASE_SECONDS ?? 30);
const maxDispatchAttempts = Number(process.env.OUTBOX_MAX_DISPATCH_ATTEMPTS ?? 10);
const shutdownGraceMs = Number(process.env.SHUTDOWN_GRACE_MS ?? 10000);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "localhost",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false
});
const notificationProvider = process.env.NOTIFICATION_PROVIDER ?? "smtp";

type OutboxEvent = {
  id: string;
  organization_id: string;
  event_type: string;
  aggregate_id: string;
  payload: {
    ticketId?: string;
    requesterId?: string;
  };
};

function summarizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function retryDelaySql(attempts: number) {
  const seconds = Math.min(300, Math.max(5, 2 ** Math.min(attempts, 8)));
  return `${seconds} seconds`;
}

async function claimOutboxEvents() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<OutboxEvent>(
      `
      WITH candidates AS (
        SELECT id
        FROM outbox_events
        WHERE event_type = 'ticket.created.notification_requested'
          AND status IN ('pending', 'failed')
          AND attempts < $1
          AND next_attempt_at <= now()
          AND (leased_until IS NULL OR leased_until < now())
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE outbox_events oe
      SET status = 'dispatching',
          leased_by = $3,
          leased_until = now() + ($4::text)::interval,
          attempts = attempts + 1,
          updated_at = now()
      FROM candidates
      WHERE oe.id = candidates.id
      RETURNING oe.id, oe.organization_id, oe.event_type, oe.aggregate_id, oe.payload
      `,
      [maxDispatchAttempts, dispatchBatchSize, workerId, `${leaseSeconds} seconds`]
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markDispatched(eventId: string) {
  await pool.query(
    `
    UPDATE outbox_events
    SET status = 'dispatched',
        dispatched_at = now(),
        leased_by = NULL,
        leased_until = NULL,
        error_summary = NULL,
        updated_at = now()
    WHERE id = $1
    `,
    [eventId]
  );
}

async function markDispatchFailed(eventId: string, attempts: number, error: unknown) {
  await pool.query(
    `
    UPDATE outbox_events
    SET status = 'failed',
        leased_by = NULL,
        leased_until = NULL,
        next_attempt_at = now() + ($2::text)::interval,
        error_summary = $3,
        updated_at = now()
    WHERE id = $1
    `,
    [eventId, retryDelaySql(attempts), summarizeError(error)]
  );
}

async function dispatchOutboxBatch() {
  const events = await claimOutboxEvents();
  for (const event of events) {
    try {
      await ticketNotificationsQueue.add(
        "outbox-notification",
        { eventId: event.id },
        { jobId: event.id }
      );
      await markDispatched(event.id);
    } catch (error) {
      const attempts = await pool.query<{ attempts: number }>(
        "SELECT attempts FROM outbox_events WHERE id = $1",
        [event.id]
      );
      await markDispatchFailed(event.id, Number(attempts.rows[0]?.attempts ?? 1), error);
    }
  }
}

async function loadOutboxEvent(eventId: string) {
  const result = await pool.query<OutboxEvent>(
    `
    SELECT id, organization_id, event_type, aggregate_id, payload
    FROM outbox_events
    WHERE id = $1
    LIMIT 1
    `,
    [eventId]
  );
  return result.rows[0];
}

async function beginNotificationAttempt(event: OutboxEvent) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{
      id: string;
      status: string;
      attempts: number;
    }>(
      `
      SELECT id, status, attempts
      FROM notification_jobs
      WHERE event_id = $1
      FOR UPDATE
      `,
      [event.id]
    );

    if (existing.rows[0]?.status === "completed" || existing.rows[0]?.status === "skipped") {
      await client.query("COMMIT");
      return {
        notificationJobId: existing.rows[0].id,
        attemptNumber: existing.rows[0].attempts,
        alreadyTerminal: true
      };
    }

    if (existing.rowCount === 0) {
      const inserted = await client.query<{ id: string; attempts: number }>(
        `
        INSERT INTO notification_jobs(
          organization_id, event_id, aggregate_id, type, payload, status, attempts, updated_at
        )
        VALUES($1, $2, $3, 'ticket-created', $4::jsonb, 'sending', 1, now())
        RETURNING id, attempts
        `,
        [event.organization_id, event.id, event.aggregate_id, JSON.stringify(event.payload)]
      );
      await client.query("COMMIT");
      return {
        notificationJobId: inserted.rows[0].id,
        attemptNumber: inserted.rows[0].attempts,
        alreadyTerminal: false
      };
    }

    const updated = await client.query<{ id: string; attempts: number }>(
      `
      UPDATE notification_jobs
      SET status = 'sending',
          attempts = attempts + 1,
          error_message = NULL,
          updated_at = now()
      WHERE id = $1
      RETURNING id, attempts
      `,
      [existing.rows[0].id]
    );
    await client.query("COMMIT");
    return {
      notificationJobId: updated.rows[0].id,
      attemptNumber: updated.rows[0].attempts,
      alreadyTerminal: false
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordAttempt(params: {
  event: OutboxEvent;
  notificationJobId: string;
  attemptNumber: number;
  status: "accepted" | "skipped" | "failed";
  providerMessageId?: string;
  errorSummary?: string;
}) {
  await pool.query(
    `
    INSERT INTO notification_attempts(
      event_id, notification_job_id, organization_id, provider, attempt_number,
      status, provider_message_id, error_summary
    )
    VALUES($1, $2, $3, 'smtp', $4, $5, $6, $7)
    `,
    [
      params.event.id,
      params.notificationJobId,
      params.event.organization_id,
      params.attemptNumber,
      params.status,
      params.providerMessageId ?? null,
      params.errorSummary ?? null
    ]
  );
}

async function markNotificationTerminal(params: {
  notificationJobId: string;
  status: "completed" | "skipped" | "failed";
  providerMessageId?: string;
  errorSummary?: string;
}) {
  await pool.query(
    `
    UPDATE notification_jobs
    SET status = $2,
        provider_message_id = $3,
        error_message = $4,
        updated_at = now()
    WHERE id = $1
    `,
    [
      params.notificationJobId,
      params.status,
      params.providerMessageId ?? null,
      params.errorSummary ?? null
    ]
  );
}

async function processNotificationEvent(eventId: string) {
  const event = await loadOutboxEvent(eventId);
  if (!event) {
    throw new Error("Outbox event not found");
  }
  if (event.event_type !== "ticket.created.notification_requested") {
    throw new Error("Unsupported outbox event type");
  }

  const attempt = await beginNotificationAttempt(event);
  if (attempt.alreadyTerminal) {
    return;
  }

  const requester = await pool.query<{
    email: string;
    full_name: string;
    subject: string;
    ticket_id: string;
  }>(
    `
    SELECT u.email, u.full_name, t.subject, t.id AS ticket_id
    FROM tickets t
    JOIN users u
      ON u.id = t.requester_id
      AND u.organization_id = t.organization_id
    WHERE t.id = $1
      AND t.organization_id = $2
      AND u.id = $3
    LIMIT 1
    `,
    [event.payload.ticketId, event.organization_id, event.payload.requesterId]
  );

  const recipient = requester.rows[0];
  if (!recipient?.email) {
    await recordAttempt({
      event,
      notificationJobId: attempt.notificationJobId,
      attemptNumber: attempt.attemptNumber,
      status: "skipped",
      errorSummary: "Missing recipient email"
    });
    await markNotificationTerminal({
      notificationJobId: attempt.notificationJobId,
      status: "skipped",
      errorSummary: "Missing recipient email"
    });
    return;
  }

  try {
    const info =
      notificationProvider === "fake"
        ? { messageId: `fake-${event.id}-${attempt.attemptNumber}` }
        : await transporter.sendMail({
            from: process.env.FROM_EMAIL ?? "support@supportdesk.local",
            to: recipient.email,
            subject: `Ticket Created: ${recipient.subject}`,
            text: `Hi ${recipient.full_name}, your ticket (${recipient.ticket_id}) was created.`
          });
    const providerMessageId =
      typeof info.messageId === "string" ? info.messageId : undefined;

    await recordAttempt({
      event,
      notificationJobId: attempt.notificationJobId,
      attemptNumber: attempt.attemptNumber,
      status: "accepted",
      providerMessageId
    });
    await markNotificationTerminal({
      notificationJobId: attempt.notificationJobId,
      status: "completed",
      providerMessageId
    });
  } catch (error) {
    const errorSummary = summarizeError(error);
    await recordAttempt({
      event,
      notificationJobId: attempt.notificationJobId,
      attemptNumber: attempt.attemptNumber,
      status: "failed",
      errorSummary
    });
    await markNotificationTerminal({
      notificationJobId: attempt.notificationJobId,
      status: "failed",
      errorSummary
    });
    throw error;
  }
}

const worker = new Worker<OutboxNotificationJob>(
  ticketNotificationsQueueName,
  async (job) => {
    await processNotificationEvent(job.data.eventId);
  },
  { connection: bullmqConnection }
);

let dispatching = false;
const dispatcher = setInterval(() => {
  if (dispatching) {
    return;
  }
  dispatching = true;
  void dispatchOutboxBatch()
    .catch((error: Error) => {
      log("error", "outbox_dispatch_failed", { error: safeError(error) });
    })
    .finally(() => {
      dispatching = false;
    });
}, dispatchIntervalMs);

worker.on("completed", (job) => {
  log("info", "notification_job_completed", { jobId: String(job.id ?? "") });
});

worker.on("failed", async (job, err) => {
  log("error", "notification_job_failed", {
    jobId: job?.id ? String(job.id) : null,
    error: safeError(err)
  });
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearInterval(dispatcher);
  log("info", "worker_shutdown_started", { graceMs: shutdownGraceMs });
  const timeout = setTimeout(() => {
    log("error", "worker_shutdown_timeout", { graceMs: shutdownGraceMs });
    process.exit(1);
  }, shutdownGraceMs);
  try {
    await worker.close();
    await ticketNotificationsQueue.close();
    await pool.end();
    await redis.quit();
    clearTimeout(timeout);
    log("info", "worker_shutdown_completed");
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    log("error", "worker_shutdown_failed", { error: safeError(error) });
    process.exit(1);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log("info", "worker_started", { dispatchIntervalMs, dispatchBatchSize });
