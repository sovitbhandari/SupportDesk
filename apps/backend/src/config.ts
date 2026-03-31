import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/zendesk_lite",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN ?? "1d") as `${number}${"ms" | "s" | "m" | "h" | "d" | "w" | "y"}` | number
};
