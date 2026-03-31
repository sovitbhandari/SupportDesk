import app from "./app.js";
import { config } from "./config.js";
import { redis, redisSubscriber } from "./lib/redis.js";

const server = app.listen(config.port, () => {
  console.log(`Backend API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close(async () => {
    await redis.quit();
    await redisSubscriber.quit();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
