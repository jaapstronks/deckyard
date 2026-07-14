/**
 * Redis-backed rate limiter using sliding window algorithm.
 * Uses Redis sorted sets for efficient, distributed rate limiting.
 *
 * Algorithm:
 * - Each request is stored as a member in a sorted set with timestamp as score
 * - On each request, we remove expired entries and count remaining
 * - If count exceeds capacity, request is denied
 *
 * This approach is more accurate than token bucket for distributed systems
 * and handles edge cases like server clock drift better.
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
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
export async function checkRateLimitRedis(key, { capacity, windowSeconds = DEFAULT_WINDOW_SECONDS }) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - windowMs;
  const redisKey = `${KEY_PREFIX}${key}`;

  const result = await withRedis(async (redis) => {
    // Use pipeline for atomic operation
    const pipeline = redis.pipeline();

    // Remove entries older than the window
    pipeline.zremrangebyscore(redisKey, 0, windowStart);

    // Count current entries in the window
    pipeline.zcard(redisKey);

    // Add current request (will be checked after)
    const requestId = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    pipeline.zadd(redisKey, now, requestId);

    // Set expiry to clean up old keys
    pipeline.expire(redisKey, windowSeconds + 10);

    const results = await pipeline.exec();

    // Extract results: [error, result] for each command
    const currentCount = results[1][1]; // zcard result

    const allowed = currentCount < capacity;
    const remaining = Math.max(0, capacity - currentCount - 1);

    if (!allowed) {
      // Remove the request we just added since it's denied
      await redis.zrem(redisKey, requestId);
    }

    return {
      allowed,
      remaining,
      resetAt: now + windowMs,
    };
  }, null);

  // If Redis is unavailable, return null to signal fallback
  return result;
}

/**
 * Simplified check that just returns boolean for compatibility with existing code.
 * @param {string} key - Rate limit key
 * @param {Object} options - Rate limit options
 * @param {number} options.capacity - Maximum requests in window
 * @param {number} options.refillPerSec - Refill rate (converted to window size)
 * @returns {Promise<boolean|null>} True if allowed, false if denied, null if Redis unavailable
 */
export async function allowRequestRedis(key, { capacity, refillPerSec }) {
  // Convert refillPerSec to window size
  // If refillPerSec = 1, window = capacity seconds (token bucket equivalent)
  // If refillPerSec = 0.25, window = capacity * 4 seconds
  const windowSeconds = Math.ceil(capacity / refillPerSec);

  const result = await checkRateLimitRedis(key, { capacity, windowSeconds });

  if (result === null) {
    return null; // Signal that Redis is unavailable
  }

  return result.allowed;
}

/**
 * Get current rate limit status without consuming a request.
 * Useful for displaying remaining quota to users.
 *
 * @param {string} key - Rate limit key
 * @param {Object} options - Rate limit options
 * @param {number} options.capacity - Maximum requests in window
 * @param {number} [options.windowSeconds] - Window size in seconds
 * @returns {Promise<{remaining: number, resetAt: number}|null>}
 */
export async function getRateLimitStatus(key, { capacity, windowSeconds = DEFAULT_WINDOW_SECONDS }) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - windowMs;
  const redisKey = `${KEY_PREFIX}${key}`;

  return withRedis(async (redis) => {
    // Clean up and count without adding
    await redis.zremrangebyscore(redisKey, 0, windowStart);
    const count = await redis.zcard(redisKey);

    return {
      remaining: Math.max(0, capacity - count),
      resetAt: now + windowMs,
      used: count,
    };
  }, null);
}

/**
 * Reset rate limit for a specific key.
 * Useful for admin operations or testing.
 *
 * @param {string} key - Rate limit key
 * @returns {Promise<boolean>} True if reset successful
 */
export async function resetRateLimit(key) {
  const redisKey = `${KEY_PREFIX}${key}`;

  const result = await withRedis(async (redis) => {
    await redis.del(redisKey);
    return true;
  }, false);

  return result;
}
