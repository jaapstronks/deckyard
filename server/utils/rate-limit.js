import { mightRedisBeAvailable, isRedisAvailable } from './redis-client.js';
import { allowRequestRedis } from './rate-limit-redis.js';

function truthy(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// IPv4 validation regex
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

// IPv6 validation regex (simplified - covers most common cases)
const IPV6_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

/**
 * Validate an IP address format.
 * @param {string} ip - The IP address to validate
 * @returns {boolean} True if valid IPv4 or IPv6 address
 */
function isValidIp(ip) {
  if (!ip || typeof ip !== 'string') return false;

  // Remove brackets from IPv6 (e.g., "[::1]" -> "::1")
  const cleaned = ip.replace(/^\[|\]$/g, '');

  // Check IPv4
  if (IPV4_REGEX.test(cleaned)) {
    const parts = cleaned.split('.');
    return parts.every((part) => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  // Check IPv6
  if (IPV6_REGEX.test(cleaned)) {
    return true;
  }

  // Check IPv4-mapped IPv6 (e.g., "::ffff:192.168.1.1")
  if (cleaned.startsWith('::ffff:')) {
    const ipv4Part = cleaned.slice(7);
    return isValidIp(ipv4Part);
  }

  return false;
}

export function getClientIp(req) {
  const trustProxy = truthy(process.env.TRUST_PROXY);
  const socketIp = String(req.socket?.remoteAddress || '').trim();

  if (trustProxy) {
    // Check X-Forwarded-For header first (most common)
    const xf = String(req.headers?.['x-forwarded-for'] || '').trim();
    if (xf) {
      // Take the first (leftmost) IP which is the original client
      const firstIp = xf.split(',')[0].trim();
      // Only use if it's a valid IP format, otherwise fall back to socket IP
      if (isValidIp(firstIp)) {
        return firstIp;
      }
      // Log invalid X-Forwarded-For attempts (potential attack)
      console.warn(`[rate-limit] Invalid X-Forwarded-For IP: ${firstIp}`);
    }

    // Check X-Real-IP header (nginx)
    const xri = String(req.headers?.['x-real-ip'] || '').trim();
    if (xri && isValidIp(xri)) {
      return xri;
    }
  }

  return socketIp || 'unknown';
}

// In-memory token bucket limiter (fallback when Redis is unavailable).
// Not suitable for multi-instance without shared storage.
const buckets = new Map();

// Cap unbounded growth of the fallback bucket map. Every distinct key
// (login:ip:<addr>, login:email:<addr>, …) otherwise stays forever, so a
// stream of unique attackers leaks memory. A token bucket that has been idle
// long enough to refill to capacity is indistinguishable from a fresh one, so
// it can be dropped without loosening the limit. We sweep lazily — only when
// the map grows past a threshold, and only on the cold path where a new key is
// inserted — to keep the common case allocation-free.
const PRUNE_THRESHOLD = 10000;

/**
 * Drop every bucket that has refilled back to (or above) full capacity at
 * `now`. Such a bucket carries no rate-limit state a fresh one wouldn't, so
 * this frees memory without changing behaviour. Only currently-throttled keys
 * (partially depleted buckets) survive.
 * @param {number} now - Current timestamp (ms), passed in for testability.
 */
function pruneBuckets(now) {
  for (const [key, b] of buckets) {
    const tokens = Math.min(b.cap, b.tokens + ((now - b.last) / 1000) * b.rps);
    if (tokens >= b.cap) buckets.delete(key);
  }
}

/**
 * In-memory token bucket rate limiting.
 * Used as fallback when Redis is unavailable.
 * @param {string} key - Rate limit key
 * @param {Object} options - Rate limit options
 * @returns {boolean} True if request is allowed
 */
function allowRequestInMemory(key, { capacity, refillPerSec }) {
  const cap = Math.max(1, Number(capacity || 0) || 1);
  const rps = Math.max(0.001, Number(refillPerSec || 0) || 1);
  const now = Date.now();

  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= PRUNE_THRESHOLD) pruneBuckets(now);
    b = { tokens: cap, last: now, cap, rps };
    buckets.set(key, b);
  }

  const elapsedSec = (now - b.last) / 1000;
  b.last = now;
  b.tokens = Math.min(cap, b.tokens + elapsedSec * rps);
  // Refresh the limits so a changed capacity/refill (and pruneBuckets) always
  // sees the current bucket shape.
  b.cap = cap;
  b.rps = rps;

  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Number of live in-memory rate-limit buckets. Exposed for tests and
 * monitoring; not part of the rate-limiting contract.
 * @returns {number}
 */
export function rateLimitBucketCount() {
  return buckets.size;
}

/**
 * Clear all in-memory rate-limit buckets. Test helper only.
 */
export function resetRateLimitBuckets() {
  buckets.clear();
}

/**
 * Rate limit a request using Redis with in-memory fallback.
 * Uses adapter pattern: tries Redis first for distributed rate limiting,
 * falls back to in-memory for single-instance deployments.
 *
 * @param {string} key - Rate limit key (e.g., "ip:action")
 * @param {Object} options - Rate limit options
 * @param {number} options.capacity - Maximum tokens/requests
 * @param {number} options.refillPerSec - Token refill rate per second
 * @returns {Promise<boolean>|boolean} True if request is allowed
 */
export function allowRequest(key, { capacity, refillPerSec }) {
  // Check if Redis might be available
  if (mightRedisBeAvailable()) {
    // Return a promise that tries Redis first
    return (async () => {
      try {
        const result = await allowRequestRedis(key, { capacity, refillPerSec });
        if (result !== null) {
          return result;
        }
        // Redis unavailable, fall back to memory
        console.warn('[rate-limit] Redis unavailable, using in-memory fallback');
      } catch (err) {
        console.warn('[rate-limit] Redis error, falling back to memory:', err.message);
      }
      return allowRequestInMemory(key, { capacity, refillPerSec });
    })();
  }

  // Redis not configured, use synchronous in-memory
  return allowRequestInMemory(key, { capacity, refillPerSec });
}

/**
 * Synchronous in-memory rate limiting.
 * Use this when you need a synchronous check and don't need Redis.
 * @param {string} key - Rate limit key
 * @param {Object} options - Rate limit options
 * @returns {boolean} True if request is allowed
 */
export function allowRequestSync(key, { capacity, refillPerSec }) {
  return allowRequestInMemory(key, { capacity, refillPerSec });
}

/**
 * Token-bucket limits for password login (brute-force throttle).
 * Burst then a slow sustained rate; per-IP catches address rotation, per-email
 * caps targeted attacks on a single account. Security hardening 3c.
 */
export const LOGIN_LIMITS = {
  ip: { capacity: 10, refillPerSec: 0.1 }, // burst 10, then ~6/min
  email: { capacity: 8, refillPerSec: 0.1 }, // burst 8, then ~6/min
};

/**
 * Throttle a password-login attempt. Consumes one token per attempt from a
 * per-IP and (only if the IP is still under budget) a per-email bucket.
 * @param {{ip?: string, email?: string}} p
 * @returns {Promise<boolean>} false when the attempt should be blocked (429)
 */
export async function allowLoginAttempt({ ip, email } = {}) {
  const ipKey = `login:ip:${String(ip || 'unknown')}`;
  const ipOk = await allowRequest(ipKey, LOGIN_LIMITS.ip);
  if (!ipOk) return false;
  const emailKey = `login:email:${String(email || 'unknown').toLowerCase()}`;
  const emailOk = await allowRequest(emailKey, LOGIN_LIMITS.email);
  return emailOk;
}
