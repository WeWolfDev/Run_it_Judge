const Redis = require('ioredis');

const WINDOW_MS = Number(process.env.SUBMISSION_RATE_WINDOW_MS || 1000);
const useRedis = process.env.SESSION_STORE === 'redis';
const memoryHits = new Map();
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

async function allowSubmission(userId) {
	if (redis) {
		try {
			if (await redisReady) {
				const ok = await redis.set(`run-it:ratelimit:${userId}`, '1', 'PX', WINDOW_MS, 'NX');
				return ok === 'OK';
			}
		} catch {
			// Redis no disponible: se usa el fallback en memoria.
		}
	}

	const last = memoryHits.get(userId) || 0;
	if (Date.now() - last < WINDOW_MS) return false;
	memoryHits.set(userId, Date.now());
	return true;
}

async function closeRateLimitStore() {
	if (redis) await redis.quit().catch(() => undefined);
}

module.exports = { allowSubmission, closeRateLimitStore, memoryHits, WINDOW_MS };