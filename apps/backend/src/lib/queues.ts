import { Queue } from "bullmq";
import { bullmqConnection } from "./redis.js";

export const ticketNotificationsQueueName = "ticket-notifications";

export type OutboxNotificationJob = {
  eventId: string;
};

export const ticketNotificationsQueue = new Queue<OutboxNotificationJob>(ticketNotificationsQueueName, {
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
