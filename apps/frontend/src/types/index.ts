export type Role = "admin" | "agent" | "customer";

export type AuthUser = {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
};

export type LoginResponse = {
  token: string;
  user: {
    id: string;
    organizationId: string;
    role: Role;
    email: string;
  };
};

export type Ticket = {
  id: string;
  organization_id: string;
  requester_id: string;
  subject: string;
  description: string;
  status: "open" | "pending" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  created_at: string;
  updated_at: string;
  active_assignment_agent_id?: string | null;
};

export type Message = {
  id: string;
  organization_id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export type Assignment = {
  id: string;
  organization_id: string;
  ticket_id: string;
  agent_id: string;
  assigned_at: string;
  released_at: string | null;
};

export type SseMessageEvent = {
  type: "ticket.message.created";
  messageId: string;
  ticketId: string;
  organizationId: string;
  senderId: string;
  recipientUserId: string;
  body: string;
  createdAt: string;
};
