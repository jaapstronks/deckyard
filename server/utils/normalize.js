/**
 * String normalization utilities.
 * Shared across server modules to avoid code duplication.
 */

/**
 * Normalize an email address.
 * Trims whitespace and converts to lowercase.
 * @param {string|null|undefined} email - The email to normalize
 * @returns {string|null} - Normalized email or null if empty
 */
export function normalizeEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  return s || null;
}

/**
 * Normalize a string value.
 * Trims whitespace.
 * @param {string|null|undefined} str - The string to normalize
 * @returns {string} - Normalized string (empty string if null/undefined)
 */
export function norm(str) {
  return String(str || '').trim();
}

// ============================================================
// TIMESTAMP UTILITIES
// ============================================================

/**
 * Get current timestamp as ISO string.
 * Replaces repeated `new Date().toISOString()` calls.
 * @returns {string} - Current timestamp in ISO format
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Get a timestamp in the future as ISO string.
 * Useful for expiration times.
 * @param {number} ms - Milliseconds from now
 * @returns {string} - Future timestamp in ISO format
 */
export function isoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

/**
 * Get a timestamp in the past as ISO string.
 * Useful for "since" queries.
 * @param {number} ms - Milliseconds ago
 * @returns {string} - Past timestamp in ISO format
 */
export function isoBefore(ms) {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Calculate duration in seconds between a start time and now.
 * Returns 0 if start time is invalid or in the future.
 * @param {string|Date} startTime - Start timestamp (ISO string or Date)
 * @returns {number} - Duration in seconds (non-negative integer)
 */
export function durationSinceSeconds(startTime) {
  if (!startTime) return 0;
  const startMs = startTime instanceof Date ? startTime.getTime() : new Date(startTime).getTime();
  if (isNaN(startMs)) return 0;
  const durationMs = Date.now() - startMs;
  return Math.max(0, Math.floor(durationMs / 1000));
}

// ============================================================
// DATE VALIDATION
// ============================================================

/**
 * Validate date range parameters for analytics queries.
 * Handles various date formats (ISO string, YYYY-MM-DD).
 *
 * @param {string|null} since - Start date (ISO string or YYYY-MM-DD)
 * @param {string|null} until - End date (ISO string or YYYY-MM-DD)
 * @param {Object} [options] - Validation options
 * @param {number} [options.maxRangeDays=365] - Maximum allowed range in days
 * @param {boolean} [options.allowFuture=false] - Whether to allow future dates
 * @returns {{valid: boolean, error?: string, since?: Date, until?: Date}}
 */
export function validateDateRange(since, until, options = {}) {
  const { maxRangeDays = 365, allowFuture = false } = options;

  // If neither provided, that's valid (use defaults)
  if (!since && !until) {
    return { valid: true };
  }

  const parsedSince = since ? new Date(since) : null;
  const parsedUntil = until ? new Date(until) : null;

  // Validate date formats
  if (since && (Number.isNaN(parsedSince.getTime()) || parsedSince.toString() === 'Invalid Date')) {
    return { valid: false, error: 'Invalid since date format' };
  }
  if (until && (Number.isNaN(parsedUntil.getTime()) || parsedUntil.toString() === 'Invalid Date')) {
    return { valid: false, error: 'Invalid until date format' };
  }

  // Validate since <= until
  if (parsedSince && parsedUntil && parsedSince > parsedUntil) {
    return { valid: false, error: 'since date must be before or equal to until date' };
  }

  // Validate reasonable date range
  const maxRange = maxRangeDays * 24 * 60 * 60 * 1000;
  if (parsedSince && parsedUntil && (parsedUntil - parsedSince) > maxRange) {
    return { valid: false, error: `Date range cannot exceed ${maxRangeDays} days` };
  }

  // Validate dates are not in the future (allow 1 day buffer for timezone issues)
  if (!allowFuture) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (parsedUntil && parsedUntil > tomorrow) {
      return { valid: false, error: 'until date cannot be in the future' };
    }
  }

  return { valid: true, since: parsedSince, until: parsedUntil };
}