import { Worker } from "bullmq";
import { ticketNotificationsQueueName, type TicketCreatedJob } from "./lib/queues.js";
import { bullmqConnection, redis } from "./lib/redis.js";

const worker = new Worker<TicketCreatedJob>(
  ticketNotificationsQueueName,
  async (job) => {
    const { ticketId, organizationId, requesterId, subject } = job.data;
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log(
      `[Worker] Email Sent | ticket=${ticketId} org=${organizationId} requester=${requesterId} subject=\"${subject}\"`
    );
  },
  { connection: bullmqConnection }
);

worker.on("completed", (job) => {
  console.log(`[Worker] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] Failed job ${job?.id}:`, err.message);
});

process.on("SIGINT", async () => {
  await worker.close();
  await redis.quit();
  process.exit(0);
});

console.log("BullMQ worker started and listening for ticket notification jobs.");
