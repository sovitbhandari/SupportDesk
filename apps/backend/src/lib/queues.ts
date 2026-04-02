import { Queue } from "bullmq";
import { bullmqConnection } from "./redis.js";

export const ticketNotificationsQueueName = "ticket-notifications";

export type TicketCreatedJob = {
  ticketId: string;
  organizationId: string;
  requesterId: string;
  subject: string;
};

export const ticketNotificationsQueue = new Queue<TicketCreatedJob>(ticketNotificationsQueueName, {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000
    },
    removeOnComplete: true
  }
});
