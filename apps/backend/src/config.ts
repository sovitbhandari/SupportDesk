import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/zendesk_lite",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN ?? "15m") as `${number}${"ms" | "s" | "m" | "h" | "d" | "w" | "y"}` | number,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me",
  jwtRefreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? "7d") as `${number}${"ms" | "s" | "m" | "h" | "d" | "w" | "y"}` | number,
  refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? "zl_refresh"
};
