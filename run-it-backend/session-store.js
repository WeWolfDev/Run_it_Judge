const Redis = require('ioredis');

const memorySessions = new Map();
const ttlSeconds = Number(process.env.SESSION_TTL_SECONDS || 28800);
const useRedis = process.env.SESSION_STORE === 'redis';
const redisConnectTimeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 3000);
let redis;

if (useRedis) {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 250, 2000),
  });
}

async function waitForRedis() {
  if (!redis) return;
  if (redis.status === 'ready') return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Redis de sesiones no está disponible'));
    }, redisConnectTimeoutMs);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Redis de sesiones no está disponible'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('error', onError);
    };

    redis.once('ready', onReady);
    redis.once('error', onError);
    if (redis.status === 'end') redis.connect().catch(onError);
  });
}

async function setSession(token, user) {
  if (redis) {
    await waitForRedis();
    await redis.set(`run-it:session:${token}`, JSON.stringify(user), 'EX', ttlSeconds);
    return;
  }
  memorySessions.set(token, user);
}

async function getSession(token) {
  if (!redis) return memorySessions.get(token) || null;
  await waitForRedis();
  const value = await redis.get(`run-it:session:${token}`);
  return value ? JSON.parse(value) : null;
}

async function deleteSession(token) {
  if (redis) {
    await waitForRedis();
    await redis.del(`run-it:session:${token}`);
    return;
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
  if (!redis) return;
  if (redis.status === 'ready') await redis.quit().catch(() => undefined);
  else redis.disconnect();
}

module.exports = {
  setSession,
  getSession,
  deleteSession,
  closeSessionStore,
  getSessionStoreStatus,
  memorySessions,
};
