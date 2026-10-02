import crypto from "node:crypto";

type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, string | number | boolean | null | undefined>;

function stableHash(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function sanitize(fields: LogFields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );
}

export function log(level: LogLevel, message: string, fields: LogFields = {}) {
  const line = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...sanitize(fields)
  };
  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

export function userHash(userId: string | undefined) {
  return stableHash(userId);
}
