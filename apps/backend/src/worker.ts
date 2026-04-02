import { Worker } from "bullmq";
import nodemailer from "nodemailer";
import { ticketNotificationsQueueName, type TicketCreatedJob } from "./lib/queues.js";
import { bullmqConnection, redis } from "./lib/redis.js";
import { pool } from "./lib/db.js";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "localhost",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false
});

const worker = new Worker<TicketCreatedJob>(
  ticketNotificationsQueueName,
  async (job) => {
    const { ticketId, organizationId, requesterId, subject } = job.data;

    const requester = await pool.query(
      "SELECT email, full_name FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1",
      [requesterId, organizationId]
    );
    const email = requester.rows[0]?.email as string | undefined;

    if (email) {
      await transporter.sendMail({
        from: process.env.FROM_EMAIL ?? "support@zendesk-lite.local",
        to: email,
        subject: `Ticket Created: ${subject}`,
        text: `Hi ${requester.rows[0].full_name}, your ticket (${ticketId}) was created.`
      });
    }

    await pool.query(
      `
      INSERT INTO notification_jobs(organization_id, type, payload, status, attempts, updated_at)
      VALUES($1, $2, $3::jsonb, 'completed', $4, now())
      `,
      [organizationId, "ticket-created", JSON.stringify(job.data), job.attemptsMade]
    );

    console.log(
      `[Worker] Email Sent | ticket=${ticketId} org=${organizationId} requester=${requesterId} subject="${subject}"`
    );
  },
  { connection: bullmqConnection }
);

worker.on("completed", (job) => {
  console.log(`[Worker] Completed job ${job.id}`);
});

worker.on("failed", async (job, err) => {
  console.error(`[Worker] Failed job ${job?.id}:`, err.message);
  if (!job) {
    return;
  }
  const payload = job.data as TicketCreatedJob;
  await pool.query(
    `
    INSERT INTO notification_jobs(organization_id, type, payload, status, attempts, error_message, updated_at)
    VALUES($1, $2, $3::jsonb, 'failed', $4, $5, now())
    `,
    [payload.organizationId, "ticket-created", JSON.stringify(payload), job.attemptsMade, err.message]
  );
});

process.on("SIGINT", async () => {
  await worker.close();
  await pool.end();
  await redis.quit();
  process.exit(0);
});

console.log("BullMQ worker started and listening for ticket notification jobs.");
