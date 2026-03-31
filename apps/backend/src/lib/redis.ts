import { Redis } from "ioredis";
import { config } from "../config.js";

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const redisSubscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const redisUrl = new URL(config.redisUrl);
export const bullmqConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379)
};
