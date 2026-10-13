/**
 * Redis-backed rate limiter using sliding window algorithm.
 * Uses Redis sorted sets for efficient, distributed rate limiting.
 *
 * Algorithm:
 * - Each request is stored as a member in a sorted set with timestamp as score
 * - On each request, we remove expired entries and count remaining
 * - If count exceeds capacity, request is denied
 *
 * The accepted request timestamps define the rolling window.
 */

import { withRedis } from './redis-client.js';

const KEY_PREFIX = 'ratelimit:';
const DEFAULT_WINDOW_SECONDS = 60;

/**
 * Check if a request is allowed under rate limit using Redis.
 * Uses sliding window log algorithm for accuracy.
 *
 * @param {string} key - Unique identifier for the rate limit bucket (e.g., "ip:group")
 * @param {Object} options - Rate limit options
 * @param {number} options.capacity - Maximum requests allowed in the window
 * @param {number} [options.windowSeconds] - Window size in seconds (default: 60)
 * @returns {Promise<{allowed: boolean, limit: number, remaining: number, resetAt: number, retryAfter: number}|null>}
 */
export async function checkRateLimitRedis(
  key,
  { capacity, windowSeconds = DEFAULT_WINDOW_SECONDS },
  runWithRedis = withRedis,
) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - windowMs;
  const redisKey = `${KEY_PREFIX}${key}`;

  const result = await runWithRedis(async (redis) => {
    // One ordered pipeline yields the count and boundary scores used by the
    // decision. Redis pipelines are not transactions.
    const pipeline = redis.pipeline();

    // Remove entries older than the window
    pipeline.zremrangebyscore(redisKey, 0, windowStart);

    // Count current entries in the window
    pipeline.zcard(redisKey);

    // The oldest score controls the next admission after a refusal; the
    // newest accepted score controls when the current window fully clears.
    pipeline.zrange(redisKey, 0, 0, 'WITHSCORES');
    pipeline.zrange(redisKey, -1, -1, 'WITHSCORES');

    // Add current request (will be checked after)
    const requestId = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    pipeline.zadd(redisKey, now, requestId);

    // Set expiry to clean up old keys
    pipeline.expire(redisKey, windowSeconds + 10);

    const results = await pipeline.exec();

    // Extract results: [error, result] for each command
    const currentCount = results[1][1]; // zcard result
    const oldest = Number(results[2][1][1]);
    const newest = Number(results[3][1][1]);

    const allowed = currentCount < capacity;
    const remaining = Math.max(0, capacity - currentCount - (allowed ? 1 : 0));

    if (!allowed) {
      // Remove the request we just added since it's denied
      await redis.zrem(redisKey, requestId);
    }

    return {
      allowed,
      limit: capacity,
      remaining,
      resetAt: Math.ceil(((allowed ? now : newest) + windowMs) / 1000),
      retryAfter: allowed
        ? 0
        : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }, null);

  // If Redis is unavailable, return null to signal fallback
  return result;
}

/** Return the Redis decision and header values from the same window check. */
export async function allowRequestRedisDetails(
  key,
  { capacity, refillPerSec },
) {
  // The existing Redis backend uses a sliding window sized from the tier's
  // sustained rate; the in-memory backend refills tokens continuously.
  const windowSeconds = Math.ceil(capacity / refillPerSec);

  const result = await checkRateLimitRedis(key, { capacity, windowSeconds });

  if (result === null) {
    return null; // Signal that Redis is unavailable
  }

  return result;
}
