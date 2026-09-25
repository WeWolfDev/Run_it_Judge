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
  if (redis) {
    if (!(await redisReady) || redis.status !== 'ready') {
      throw new Error('Redis de sesiones no está disponible');
    }
    await redis.set(`run-it:session:${token}`, JSON.stringify(user), 'EX', ttlSeconds);
  }
  memorySessions.set(token, user);
}

async function getSession(token) {
  if (!redis) return memorySessions.get(token) || null;
  if (!(await redisReady) || redis.status !== 'ready') {
    throw new Error('Redis de sesiones no está disponible');
  }
  const value = await redis.get(`run-it:session:${token}`);
  return value ? JSON.parse(value) : null;
}

async function deleteSession(token) {
  if (redis) {
    if (!(await redisReady) || redis.status !== 'ready') {
      throw new Error('Redis de sesiones no está disponible');
    }
    await redis.del(`run-it:session:${token}`);
  }
  memorySessions.delete(token);
}

function getSessionStoreStatus() {
  return {
    store: useRedis ? 'redis' : 'memory',
    ready: !useRedis || redis?.status === 'ready',
  };
}

async function closeSessionStore() {
  if (redis) await redis.quit().catch(() => undefined);
}

module.exports = {
  setSession,
  getSession,
  deleteSession,
  closeSessionStore,
  getSessionStoreStatus,
  memorySessions,
};
