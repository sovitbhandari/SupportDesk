import { redis } from "./redis.js";

export const messageChannel = "ticket:messages";

export type TicketMessageEvent = {
  type: "ticket.message.created";
  ticketId: string;
  organizationId: string;
  senderId: string;
  recipientUserId: string;
  body: string;
  createdAt: string;
};

export async function publishMessageEvent(event: TicketMessageEvent) {
  await redis.publish(messageChannel, JSON.stringify(event));
}
