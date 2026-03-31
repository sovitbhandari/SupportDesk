import type { Request } from "express";

export type UserRole = "customer" | "agent" | "admin";

export type AuthUser = {
  userId: string;
  organizationId: string;
  role: UserRole;
  email: string;
};

export type AuthedRequest = Request & {
  auth?: AuthUser;
};
