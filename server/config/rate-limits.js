/**
 * The rate-limit table — every inbound request-rate limit in one place.
 *
 * All groups are token buckets consumed through `allowRequest()` (or its
 * sync/login/share wrappers) in `server/utils/rate-limit.js`:
 * `capacity` = burst size, `refillPerSec` = sustained rate.
 *
 * Deliberately NOT in this table:
 * - `utils/sse-limiter.js` — concurrent connection slots, not requests/time.
 * - `storage/api-keys.js :: TIER_LIMITS` — the public-API tier contract
 *   (per-minute/per-day quotas per key tier); `apiTierBucket()` below turns
 *   its per-minute figure into a bucket.
 * - `utils/notion/client.js` — an outbound throttle on Deckyard's own calls
 *   to the Notion API, not an inbound limit.
 */

/**
 * Per-IP limits for expensive authenticated app routes, keyed by route
 * group (applied in `server.js` before dispatch).
 */
export const REQUEST_LIMITS = {
  export: { capacity: 8, refillPerSec: 0.25 }, // ~15/min
  publish: { capacity: 6, refillPerSec: 0.2 }, // ~12/min
  create: { capacity: 6, refillPerSec: 0.2 }, // ~12/min
  update: { capacity: 30, refillPerSec: 1 }, // ~60/min
  follow_post: { capacity: 20, refillPerSec: 1 }, // ~60/min
};

/**
 * Password login (brute-force throttle). Burst then a slow sustained rate;
 * per-IP catches address rotation, per-email caps targeted attacks on a
 * single account. Security hardening 3c. Values are security-relevant —
 * do not loosen without a review.
 */
export const LOGIN_LIMITS = {
  ip: { capacity: 10, refillPerSec: 0.1 }, // burst 10, then ~6/min
  email: { capacity: 8, refillPerSec: 0.1 }, // burst 8, then ~6/min
};

/**
 * Anonymous share-link password gate (`POST /api/share/:token/verify`).
 * Mirrors the guest-verification limit in `storage/share-links/guests.js`
 * (3 requests per actor per hour): an anonymous caller carries no session,
 * so the only actor signal is the IP. Caps password guesses at 3/hour per
 * IP — a brute-force throttle for a secret behind an anonymous endpoint.
 */
export const SHARE_VERIFY_LIMITS = {
  ip: { capacity: 3, refillPerSec: 3 / 3600 }, // burst 3, then ~3/hour
};

/**
 * Anonymous notes-companion write (`PUT /api/live-sessions/:id/notes/:slideId`).
 * A volume cap, not a guess cap: the session id is the capability and the
 * caller is allowed to write; a leaked join link must not be usable to
 * hammer the deck's slides column.
 */
export const COMPANION_NOTES_LIMITS = {
  ip: { capacity: 30, refillPerSec: 1 }, // burst 30, then ~1/second
};

/**
 * Public analytics tracking endpoints.
 */
export const TRACKING_RATE_LIMITS = {
  // Per-IP limits for public tracking endpoints
  sessionStart: { capacity: 10, refillPerSec: 0.5 }, // 10 burst, 1 per 2 seconds
  heartbeat: { capacity: 20, refillPerSec: 2 }, // 20 burst, 2 per second
  sessionEnd: { capacity: 10, refillPerSec: 1 }, // 10 burst, 1 per second
  slideView: { capacity: 30, refillPerSec: 3 }, // 30 burst, 3 per second

  // Per-session rate limits (more restrictive)
  sessionHeartbeat: { capacity: 5, refillPerSec: 0.5 }, // 5 burst, 1 per 2 seconds
  sessionSlideView: { capacity: 10, refillPerSec: 1 }, // 10 burst, 1 per second
};

/**
 * Authenticated analytics endpoints.
 */
export const AUTH_RATE_LIMITS = {
  // Standard authenticated endpoints (per user)
  standard: { capacity: 60, refillPerSec: 1 }, // 60 burst, 1 per second

  // Expensive operations (reports, exports)
  expensive: { capacity: 10, refillPerSec: 0.2 }, // 10 burst, 1 per 5 seconds

  // Public report access (prevent token enumeration)
  publicReport: { capacity: 10, refillPerSec: 0.2 }, // 10 burst, 1 per 5 seconds
};

/**
 * Public lead submission.
 */
export const LEAD_RATE_LIMITS = {
  perIp: { capacity: 10, refillPerSec: 0.167 }, // 10 burst, ~10 per minute per IP
  global: { capacity: 100, refillPerSec: 1.667 }, // 100 burst, ~100 per minute globally
};

/**
 * Follow-code endpoints. Token buckets sized to the former fixed-window
 * limits (create 10/hour, resolve 60/hour per IP): same hourly ceiling,
 * burst equal to the old window maximum.
 */
export const FOLLOW_CODE_LIMITS = {
  create: { capacity: 10, refillPerSec: 10 / 3600 }, // burst 10, ~10/hour
  resolve: { capacity: 60, refillPerSec: 60 / 3600 }, // burst 60, ~60/hour
};

/**
 * Turn a public-API tier's requests-per-minute quota into a token bucket.
 * @param {number} requestsPerMinute
 * @returns {{capacity: number, refillPerSec: number}}
 */
export function apiTierBucket(requestsPerMinute) {
  return { capacity: requestsPerMinute, refillPerSec: requestsPerMinute / 60 };
}
