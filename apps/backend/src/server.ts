import app from "./app.js";
import { config } from "./config.js";
import { redis, redisSubscriber } from "./lib/redis.js";
import { appPool, pool } from "./lib/db.js";
import { log, safeError } from "./lib/logger.js";

const server = app.listen(config.port, () => {
  log("info", "api_started", { port: config.port });
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log("info", "api_shutdown_started", { graceMs: config.shutdownGraceMs });

  const timeout = setTimeout(() => {
    log("error", "api_shutdown_timeout", { graceMs: config.shutdownGraceMs });
    process.exit(1);
  }, config.shutdownGraceMs);

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await Promise.all([pool.end(), appPool.end(), redis.quit(), redisSubscriber.quit()]);
    clearTimeout(timeout);
    log("info", "api_shutdown_completed");
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    log("error", "api_shutdown_failed", { error: safeError(error) });
    process.exit(1);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
