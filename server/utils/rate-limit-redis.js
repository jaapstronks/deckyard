/**
 * Distributed token bucket. One Lua execution refills, consumes and returns
 * the decision snapshot, so concurrent instances cannot spend the same token.
 */
import { withRedis } from './redis-client.js';
import { normalizeRateLimitOptions } from './rate-limit-options.js';

// A separate namespace avoids interpreting old sliding-window sorted sets as
// hashes during a rolling upgrade. Old keys expire under their existing TTL.
const KEY_PREFIX = 'ratelimit:token-bucket:';

const CONSUME = `
local cap = tonumber(ARGV[1])
local rps = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local state = redis.call('HMGET', KEYS[1], 'tokens', 'last')
local tokens = tonumber(state[1]) or cap
local last = tonumber(state[2]) or now
tokens = math.min(cap, tokens + ((now - last) / 1000) * rps)
local allowed = tokens >= 1
if allowed then tokens = tokens - 1 end
redis.call('HSET', KEYS[1], 'tokens', string.format('%.17g', tokens), 'last', now)
-- Once fully refilled, the bucket is equivalent to an absent key.
redis.call('PEXPIRE', KEYS[1], math.max(1, math.ceil((cap - tokens) / rps * 1000)))
local retry = 0
if not allowed then retry = math.ceil((1 - tokens) / rps) end
-- Redis Lua truncates numeric return values, so capacity travels as a string.
return {allowed and 1 or 0, string.format('%.17g', cap), math.floor(tokens),
  math.ceil((now + ((cap - tokens) / rps) * 1000) / 1000), retry}
`;

/**
 * Consume one token and return decision/header values atomically.
 * Null explicitly signals Redis failure; the caller owns local fallback.
 * @param {string} key
 * @param {{capacity: number, refillPerSec: number}} options
 * @param {Function} runWithRedis - Redis executor, injectable for integration tests
 * @returns {Promise<{allowed: boolean, limit: number, remaining: number, resetAt: number, retryAfter: number}|null>}
 */
export async function allowRequestRedisDetails(
  key,
  options,
  runWithRedis = withRedis,
) {
  const { capacity, refillPerSec } = normalizeRateLimitOptions(options);
  const now = Date.now();
  return runWithRedis(async (redis) => {
    const result = await redis.eval(
      CONSUME,
      1,
      `${KEY_PREFIX}${key}`,
      capacity,
      refillPerSec,
      now,
    );
    return {
      allowed: result[0] === 1,
      limit: Number(result[1]),
      remaining: result[2],
      resetAt: result[3],
      retryAfter: result[4],
    };
  }, null);
}
