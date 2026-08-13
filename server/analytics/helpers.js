/**
 * Shared utilities for analytics feature.
 * Centralizes configuration, validation, rate limiting responses, and security logging.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('analytics');

// ============================================================
// CONFIGURATION CONSTANTS (can be overridden via env vars)
// ============================================================

/**
 * Analytics configuration with environment variable overrides.
 */
export const ANALYTICS_CONFIG = {
  // Heartbeat interval (client-side sends heartbeats at this rate)
  HEARTBEAT_INTERVAL_MS: parseInt(process.env.ANALYTICS_HEARTBEAT_INTERVAL_MS || '', 10) || 30000,

  // Active session threshold (sessions with activity within this window are "active")
  ACTIVE_THRESHOLD_SECONDS: parseInt(process.env.ANALYTICS_ACTIVE_THRESHOLD_SECONDS || '', 10) || 60,

  // SSE connection timeout (max time for real-time viewer connection)
  SSE_TIMEOUT_MS: parseInt(process.env.ANALYTICS_SSE_TIMEOUT_MS || '', 10) || 60 * 60 * 1000, // 1 hour

  // SSE update interval (how often to push viewer counts)
  SSE_UPDATE_INTERVAL_MS: parseInt(process.env.ANALYTICS_SSE_UPDATE_INTERVAL_MS || '', 10) || 5000,

  // Max user-agent length (truncate to prevent storage abuse)
  MAX_USER_AGENT_LENGTH: parseInt(process.env.ANALYTICS_MAX_USER_AGENT_LENGTH || '', 10) || 500,

  // Max slide index (sanity check for slide navigation)
  MAX_SLIDE_INDEX: parseInt(process.env.ANALYTICS_MAX_SLIDE_INDEX || '', 10) || 1000,

  // Retention lives in instance settings, not here: the cleanup job reads
  // `settings.analytics.retention.*` so the admin UI is the single source of
  // truth (`server/storage/settings.js` getAnalyticsRetention). The env vars
  // ANALYTICS_RETENTION_DAYS / ANALYTICS_IP_ANONYMIZATION_DAYS survive only as
  // the *seed* for those settings' defaults, applied there.
};

// ============================================================
// VALIDATION PATTERNS
// ============================================================

/**
 * Device ID validation regex (32 hex chars).
 */
const DEVICE_ID_REGEX = /^[a-f0-9]{32}$/i;

/**
 * Session token validation regex (64 hex chars).
 */
const SESSION_TOKEN_REGEX = /^[a-f0-9]{64}$/i;

/**
 * Validate device ID format.
 * @param {string} deviceId - The device ID to validate
 * @returns {boolean} True if valid
 */
export function isValidDeviceId(deviceId) {
  return deviceId && DEVICE_ID_REGEX.test(deviceId);
}

/**
 * Validate session token format.
 * @param {string} token - The session token to validate
 * @returns {boolean} True if valid
 */
export function isValidSessionToken(token) {
  return token && SESSION_TOKEN_REGEX.test(token);
}

/**
 * Validate slide index.
 * @param {*} slideIndex - The slide index to validate
 * @returns {boolean} True if valid
 */
export function isValidSlideIndex(slideIndex) {
  return (
    typeof slideIndex === 'number' &&
    Number.isInteger(slideIndex) &&
    slideIndex >= 0 &&
    slideIndex <= ANALYTICS_CONFIG.MAX_SLIDE_INDEX
  );
}

/**
 * Sanitize user agent string (truncate to max length).
 * @param {string} userAgent - The user agent string
 * @returns {string|null} Sanitized user agent or null
 */
export function sanitizeUserAgent(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return null;
  const trimmed = userAgent.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= ANALYTICS_CONFIG.MAX_USER_AGENT_LENGTH) return trimmed;
  return trimmed.slice(0, ANALYTICS_CONFIG.MAX_USER_AGENT_LENGTH);
}

// ============================================================
// PUBLIC IDENTIFIERS
// ============================================================

/**
 * Length of a public device label, in hex characters. Twelve hex chars is
 * 48 bits: far too wide to collide within one deck's session list, far too
 * narrow to be worth attacking.
 */
const DEVICE_LABEL_HEX_LENGTH = 12;

/**
 * Ephemeral per-boot key, generated once when this module loads. It stands in
 * for `AUTH_SECRET` in the boot modes that legitimately run without one —
 * auth-off, sandbox, demo. 32 random bytes: as unguessable as a real secret, so
 * the label stays unreversible and cross-deck correlation stays broken. Its one
 * difference from `AUTH_SECRET` is that it does not survive a restart, which is
 * irrelevant in exactly those modes — a returning-viewer marker only has to be
 * stable within a boot, and a secretless instance keeps nothing to be stable
 * against across restarts anyway.
 *
 * Not a fallback *constant*: a fixed string would be the same on every install
 * and therefore guessable, reinstating the reversibility the real secret
 * prevents. The randomness is the whole point.
 */
const EPHEMERAL_LABEL_KEY = randomBytes(32).toString('hex');

/**
 * The key `publicDeviceLabel` derives labels with, and where it came from: the
 * configured `AUTH_SECRET` when one is set, otherwise the ephemeral per-boot
 * key. Exposed so the boot-mode contract is pinnable — a real secret is always
 * preferred, and only its absence falls back — without leaking the key material
 * itself.
 *
 * @returns {{ source: 'auth-secret' | 'ephemeral' }}
 */
export function deviceLabelKeySource() {
  return { source: String(process.env.AUTH_SECRET || '').trim() ? 'auth-secret' : 'ephemeral' };
}

/**
 * Resolve the HMAC key: the configured secret, or the ephemeral per-boot key
 * when none is set. Read at call time so a secret configured after import (as
 * tests do) is honoured.
 * @returns {string}
 */
function deviceLabelKey() {
  return String(process.env.AUTH_SECRET || '').trim() || EPHEMERAL_LABEL_KEY;
}

/**
 * Derive the per-deck label that stands in for a raw device id on a response.
 *
 * The raw `view_sessions.device_id` is browser-generated and instance-wide: the
 * same 32-hex value appears on every deck that browser visits. Handing it to
 * anyone with read access to a deck lets two deck owners compare lists and
 * correlate the same visitor across their decks. Keying the label to the
 * presentation breaks that: the same browser reads as a different label in
 * every deck, while staying stable *within* a deck, which is the only thing the
 * viewer list needs it for ("this is a returning viewer").
 *
 * HMAC rather than a truncation of the raw id: a prefix of the same id is the
 * same string in every deck, so truncating would preserve exactly the
 * cross-deck correlation this removes. The secret makes the mapping
 * unreproducible by anyone who has only the label.
 *
 * Applied at the response boundary only — the raw id stays in the database,
 * where the erasure path needs it and `COUNT(DISTINCT device_id)` aggregations
 * keep working.
 *
 * The key is the configured `AUTH_SECRET`, or an ephemeral per-boot key when
 * none is set (see `EPHEMERAL_LABEL_KEY`). A guessable *constant* fallback is
 * still refused — that would reinstate the reversibility the secret prevents —
 * but a random per-boot key derives a usable label in the secretless boot modes
 * (auth-off/sandbox/demo) instead of throwing and 500-ing the session list.
 *
 * @param {string|null|undefined} deviceId - The raw device id from storage.
 * @param {string} presentationId - The deck the response is about.
 * @returns {string|null} 12 hex chars, or null when there is no device id.
 * @throws {Error} When called without a presentation id — the label is per-deck
 *   by construction, so a deckless one would be an instance-wide identifier
 *   again.
 */
export function publicDeviceLabel(deviceId, presentationId) {
  if (deviceId === null || deviceId === undefined || deviceId === '') return null;

  const presId = String(presentationId || '').trim();
  if (!presId) {
    throw new Error(
      'publicDeviceLabel requires a presentation id: the label is per-deck by construction'
    );
  }

  return createHmac('sha256', deviceLabelKey())
    .update(`${String(deviceId)}:${presId}`)
    .digest('hex')
    .slice(0, DEVICE_LABEL_HEX_LENGTH);
}

// ============================================================
// HTTP RESPONSE HELPERS
// ============================================================

/**
 * Send a rate limit exceeded response.
 * @param {Object} res - The response object
 * @param {string} [message] - Optional custom message
 * @param {number} [retryAfter] - Retry-After header value in seconds
 */
export function sendRateLimitResponse(res, message = 'Rate limit exceeded', retryAfter = 5) {
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': String(retryAfter),
  });
  res.end(JSON.stringify({ error: message }));
}

/**
 * Send a JSON error response.
 * @param {Object} res - The response object
 * @param {number} status - HTTP status code
 * @param {string} error - Error message
 */
export function sendErrorResponse(res, status, error) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error }));
}

/**
 * Send a JSON success response.
 * @param {Object} res - The response object
 * @param {Object} data - Response data
 * @param {number} [status] - HTTP status code (default 200)
 */
export function sendSuccessResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ============================================================
// SECURITY LOGGING
// ============================================================

/**
 * Security event types for logging.
 */
export const SECURITY_EVENTS = {
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  INVALID_TOKEN: 'invalid_token',
  INVALID_DEVICE_ID: 'invalid_device_id',
  ACCESS_DENIED: 'access_denied',
  SUSPICIOUS_REQUEST: 'suspicious_request',
};

/**
 * Log a security event.
 * @param {string} event - Event type from SECURITY_EVENTS
 * @param {Object} details - Event details
 * @param {string} [details.ip] - Client IP address
 * @param {string} [details.endpoint] - Request endpoint
 * @param {string} [details.reason] - Additional context
 */
export function logSecurityEvent(event, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    ...details,
  };

  // Log to console with prefix for easy filtering
  log.warn(`${event}:`, JSON.stringify(logEntry));

  // TODO: In production, send to centralized logging/SIEM system
  // Example: await sendToSecurityLog(logEntry);
}

// ============================================================
// ACCESS VALIDATION
// ============================================================

/**
 * Valid source types for analytics tracking.
 */
export const SOURCE_TYPES = {
  SHARE_LINK: 'share_link',
  FOLLOW: 'follow',
  EMBED: 'embed',
  PUBLISHED: 'published',
};

/**
 * Check if a source type is valid.
 * @param {string} sourceType - The source type to check
 * @returns {boolean}
 */
export function isValidSourceType(sourceType) {
  return Object.values(SOURCE_TYPES).includes(sourceType);
}

// ============================================================
// QUERY HELPERS
// ============================================================

/**
 * Apply date range filters to a Kysely query.
 * Reduces repetition of since/until filtering across storage modules.
 * @param {Object} query - Kysely query builder
 * @param {Object} opts - Filter options
 * @param {string} [opts.since] - Start date (ISO string or date-only YYYY-MM-DD)
 * @param {string} [opts.until] - End date (ISO string or date-only YYYY-MM-DD)
 * @param {string} [column] - Column name to filter on (default: 'started_at')
 * @returns {Object} Query with date filters applied
 */
export function applyDateFilters(query, opts, column = 'started_at') {
  if (opts?.since) {
    query = query.where(column, '>=', opts.since);
  }
  if (opts?.until) {
    // If until is a date-only string (YYYY-MM-DD), include the entire day
    // by converting to end of day. Otherwise PostgreSQL interprets '2026-01-21'
    // as midnight, excluding any records from later in the day.
    let untilValue = opts.until;
    if (/^\d{4}-\d{2}-\d{2}$/.test(opts.until)) {
      untilValue = `${opts.until}T23:59:59.999Z`;
    }
    query = query.where(column, '<=', untilValue);
  }
  return query;
}