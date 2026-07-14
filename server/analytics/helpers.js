/**
 * Shared utilities for analytics feature.
 * Centralizes configuration, validation, rate limiting responses, and security logging.
 */

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

  // Data retention (days before cleanup)
  RETENTION_DAYS: parseInt(process.env.ANALYTICS_RETENTION_DAYS || '', 10) || 90,

  // IP anonymization (days before IPs are anonymized)
  IP_ANONYMIZATION_DAYS: parseInt(process.env.ANALYTICS_IP_ANONYMIZATION_DAYS || '', 10) || 30,
};

// ============================================================
// RATE LIMITING CONFIGURATION
// ============================================================

/**
 * Rate limits for tracking endpoints.
 * Uses token bucket algorithm with capacity (burst) and refill rate.
 */
export const TRACKING_RATE_LIMITS = {
  // Per-IP limits for public tracking endpoints
  sessionStart: { capacity: 10, refillPerSec: 0.5 }, // 10 burst, 1 per 2 seconds
  heartbeat: { capacity: 20, refillPerSec: 2 },      // 20 burst, 2 per second
  sessionEnd: { capacity: 10, refillPerSec: 1 },     // 10 burst, 1 per second
  slideView: { capacity: 30, refillPerSec: 3 },      // 30 burst, 3 per second

  // Per-session rate limits (more restrictive)
  sessionHeartbeat: { capacity: 5, refillPerSec: 0.5 },  // 5 burst, 1 per 2 seconds
  sessionSlideView: { capacity: 10, refillPerSec: 1 },   // 10 burst, 1 per second
};

/**
 * Rate limits for authenticated analytics endpoints.
 */
export const AUTH_RATE_LIMITS = {
  // Standard authenticated endpoints (per user)
  standard: { capacity: 60, refillPerSec: 1 }, // 60 burst, 1 per second

  // Expensive operations (reports, exports)
  expensive: { capacity: 10, refillPerSec: 0.2 }, // 10 burst, 1 per 5 seconds

  // Public report access (prevent token enumeration)
  publicReport: { capacity: 10, refillPerSec: 0.2 }, // 10 burst, 1 per 5 seconds
};

// ============================================================
// VALIDATION PATTERNS
// ============================================================

/**
 * Device ID validation regex (32 hex chars).
 */
export const DEVICE_ID_REGEX = /^[a-f0-9]{32}$/i;

/**
 * Session token validation regex (64 hex chars).
 */
export const SESSION_TOKEN_REGEX = /^[a-f0-9]{64}$/i;

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
  console.warn(`[security] ${event}:`, JSON.stringify(logEntry));

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