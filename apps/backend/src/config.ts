import "dotenv/config";

const defaultCorsOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    return defaultCorsOrigins;
  }
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? [...new Set(parts)] : defaultCorsOrigins;
}

const resolvedCorsOrigins = parseCorsOrigins();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/supportdesk",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  /** Primary origin (first in list) — used where a single string is needed */
  corsOrigin: resolvedCorsOrigins[0],
  /** All allowed browser origins in dev (localhost + 127.0.0.1, or comma-separated in CORS_ORIGIN) */
  corsOrigins: resolvedCorsOrigins,
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN ?? "15m") as `${number}${"ms" | "s" | "m" | "h" | "d" | "w" | "y"}` | number,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me",
  jwtRefreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? "7d") as `${number}${"ms" | "s" | "m" | "h" | "d" | "w" | "y"}` | number,
  refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? "zl_refresh"
};
