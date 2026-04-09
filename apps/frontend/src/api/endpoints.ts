import { apiRequest } from "./client";
import type { Assignment, LoginResponse, Message, RegisterResponse, Ticket } from "../types";

export async function login(email: string, password: string) {
  return apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function register(payload: {
  fullName: string;
  email: string;
  password: string;
  organizationName: string;
  organizationSlug?: string;
}) {
  return apiRequest<RegisterResponse>(
    "/api/auth/register",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export async function me(token: string) {
  return apiRequest<{ user: { userId: string; organizationId: string; role: "admin" | "agent" | "customer"; email: string } }>(
    "/api/auth/me",
    undefined,
    token
  );
}

export async function getProfile(token: string) {
  const result = await apiRequest<{
    data: {
      id: string;
      organization_id: string;
      email: string;
      full_name: string;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    };
  }>("/api/profile/me", undefined, token);
  return result.data;
}

export async function updateProfile(
  token: string,
  payload: { fullName?: string; email?: string }
) {
  const result = await apiRequest<{ data: { id: string; email: string; full_name: string } }>(
    "/api/profile/me",
    {
      method: "PATCH",
      body: JSON.stringify(payload)
    },
    token
  );
  return result.data;
}

export async function updatePassword(
  token: string,
  payload: { currentPassword: string; newPassword: string }
) {
  return apiRequest<{ message: string }>(
    "/api/profile/me/password",
    {
      method: "PATCH",
      body: JSON.stringify(payload)
    },
    token
  );
}

export async function listEmployees(token: string) {
  const result = await apiRequest<{
    data: Array<{ id: string; email: string; full_name: string; is_active: boolean; role: "admin" | "agent" | "customer" }>;
  }>("/api/admin/employees", undefined, token);
  return result.data;
}

export async function listUsers(token: string) {
  const result = await apiRequest<{
    data: Array<{
      id: string;
      organization_id: string;
      email: string;
      full_name: string;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>;
  }>("/api/users", undefined, token);
  return result.data;
}

export async function updateEmployee(
  token: string,
  id: string,
  payload: { role?: "admin" | "agent" | "customer"; isActive?: boolean }
) {
  const result = await apiRequest<{ data: { id: string; role: "admin" | "agent" | "customer"; is_active: boolean } }>(
    `/api/admin/employees/${id}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token
  );
  return result.data;
}

export async function listTickets(
  token: string,
  params?: { status?: string; assignedToMe?: boolean; unassigned?: boolean }
) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.assignedToMe) qs.set("assigned_to", "me");
  if (params?.unassigned) qs.set("unassigned", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const result = await apiRequest<{ data: Ticket[] }>(`/api/tickets${suffix}`, undefined, token);
  return result.data;
}

export async function createTicket(
  token: string,
  payload: { subject: string; description: string; priority: "low" | "medium" | "high" | "urgent" }
) {
  const result = await apiRequest<{ data: Ticket }>("/api/tickets", {
    method: "POST",
    body: JSON.stringify(payload)
  }, token);
  return result.data;
}

export async function assignTicket(token: string, ticketId: string, agentId?: string) {
  const result = await apiRequest<{ data: Assignment }>(`/api/tickets/${ticketId}/assign`, {
    method: "POST",
    body: JSON.stringify(agentId ? { agentId } : {})
  }, token);
  return result.data;
}

export async function updateTicketStatus(
  token: string,
  ticketId: string,
  status: "open" | "pending" | "resolved" | "closed"
) {
  const result = await apiRequest<{ data: Ticket }>(
    `/api/tickets/${ticketId}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
    token
  );
  return result.data;
}

export async function listMessages(token: string, ticketId: string) {
  const result = await apiRequest<{ data: Message[] }>(`/api/tickets/${ticketId}/messages`, undefined, token);
  return result.data;
}

export async function sendMessage(token: string, ticketId: string, body: string) {
  const result = await apiRequest<{ data: Message }>(`/api/tickets/${ticketId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body })
  }, token);
  return result.data;
}
