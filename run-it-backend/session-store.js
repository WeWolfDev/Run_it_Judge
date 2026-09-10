const Redis = require('ioredis');

const memorySessions = new Map();
const ttlSeconds = Number(process.env.SESSION_TTL_SECONDS || 28800);
const useRedis = process.env.SESSION_STORE === 'redis';
let redis;
let redisReady;

if (useRedis) {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redisReady = redis.connect().catch(() => false);
}

async function setSession(token, user) {
  memorySessions.set(token, user);
  if (!redis) return;
  try {
    if (await redisReady) await redis.set(`run-it:session:${token}`, JSON.stringify(user), 'EX', ttlSeconds);
  } catch {
    // Keep the in-memory fallback when Redis is unavailable.
  }
}

async function getSession(token) {
  if (!redis) return memorySessions.get(token) || null;
  try {
    if (await redisReady) {
      const value = await redis.get(`run-it:session:${token}`);
      return value ? JSON.parse(value) : null;
    }
  } catch {
    // Keep the in-memory fallback when Redis is unavailable.
  }
  return memorySessions.get(token) || null;
}

async function deleteSession(token) {
  memorySessions.delete(token);
  if (redis) {
    try {
      if (await redisReady) await redis.del(`run-it:session:${token}`);
    } catch {
      // Session removal remains effective for the local fallback.
    }
  }
}

async function closeSessionStore() {
  if (redis) await redis.quit().catch(() => undefined);
}

module.exports = { setSession, getSession, deleteSession, closeSessionStore, memorySessions };
