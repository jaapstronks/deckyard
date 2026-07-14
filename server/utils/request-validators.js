/**
 * Request parameter validation utilities.
 * Extracts and validates common request body fields.
 */

import { validateDateRange } from './normalize.js';
import { badRequest } from './http.js';
import { ALL_PERMISSIONS, isValidPermission as _isValidPermission } from '../../shared/constants/permissions.js';

/**
 * Extract a required string field from the request body.
 * Returns empty string if missing.
 * @param {object} body - Request body
 * @param {string} key - Field name
 * @returns {string}
 */
export function getString(body, key) {
  return typeof body?.[key] === 'string' ? body[key] : '';
}

/**
 * Extract an optional string field from the request body.
 * Returns null if missing or not a string.
 * @param {object} body - Request body
 * @param {string} key - Field name
 * @returns {string|null}
 */
export function getOptionalString(body, key) {
  return typeof body?.[key] === 'string' ? body[key] : null;
}

/**
 * Extract an optional string field and trim it.
 * Returns null if missing, empty, or whitespace-only.
 * @param {object} body - Request body
 * @param {string} key - Field name
 * @returns {string|null}
 */
export function getTrimmedString(body, key) {
  const val = body?.[key];
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed || null;
}

/**
 * Extract and validate a language field.
 * Only accepts 'nl' or 'en-GB'.
 * @param {object} body - Request body
 * @param {string} [key='lang'] - Field name
 * @returns {'nl'|'en-GB'|null}
 */
export function getLang(body, key = 'lang') {
  const val = body?.[key];
  return val === 'nl' || val === 'en-GB' ? val : null;
}

/**
 * Extract and validate a language field with 'auto' option.
 * Returns 'auto' if not 'nl' or 'en-GB'.
 * @param {object} body - Request body
 * @param {string} [key='lang'] - Field name
 * @returns {'nl'|'en-GB'|'auto'}
 */
export function getLangOrAuto(body, key = 'lang') {
  const val = body?.[key];
  return val === 'nl' || val === 'en-GB' ? val : 'auto';
}

/**
 * Extract an optional object field from the request body.
 * Returns null if missing or not an object.
 * @param {object} body - Request body
 * @param {string} key - Field name
 * @returns {object|null}
 */
export function getOptionalObject(body, key) {
  const val = body?.[key];
  return val && typeof val === 'object' && !Array.isArray(val) ? val : null;
}

/**
 * Extract an optional boolean field from the request body.
 * Returns the default value if missing.
 * @param {object} body - Request body
 * @param {string} key - Field name
 * @param {boolean} defaultValue - Default if missing
 * @returns {boolean}
 */
export function getBoolean(body, key, defaultValue = false) {
  const val = body?.[key];
  return typeof val === 'boolean' ? val : defaultValue;
}

/**
 * Extract common AI endpoint parameters.
 * @param {object} body - Request body
 * @returns {{ raw: string, vendor: string|null, lang: 'nl'|'en-GB'|null, theme: string|null, settings: object|null }}
 */
export function getAiParams(body) {
  return {
    raw: getString(body, 'raw'),
    vendor: getOptionalString(body, 'vendor'),
    lang: getLang(body),
    theme: getTrimmedString(body, 'theme'),
    settings: getOptionalObject(body, 'settings'),
  };
}

/**
 * Extract common file conversion parameters.
 * @param {object} body - Request body
 * @returns {{ dataUrl: string, filename: string, vendor: string|null, lang: 'nl'|'en-GB'|'auto', theme: string }}
 */
export function getConvertParams(body) {
  return {
    dataUrl: getString(body, 'dataUrl'),
    filename: getString(body, 'filename'),
    vendor: getOptionalString(body, 'vendor'),
    lang: getLangOrAuto(body),
    theme: getTrimmedString(body, 'theme') || 'default',
  };
}

// ============================================================
// PERMISSION VALIDATION
// ============================================================

/**
 * Valid permission levels for collaborators and share links.
 * Re-exported from shared/constants/permissions.js for backwards compatibility.
 */
export const VALID_PERMISSIONS = ALL_PERMISSIONS;

/**
 * Validate a permission string.
 * Re-exported from shared/constants/permissions.js for backwards compatibility.
 * @param {string} permission - The permission to validate
 * @returns {boolean} - True if valid
 */
export const isValidPermission = _isValidPermission;

/**
 * Validate permission and send badRequest if invalid.
 * @param {string} permission - The permission to validate
 * @param {Object} res - HTTP response object
 * @returns {boolean} - True if valid, false if error response was sent
 */
export function validatePermission(permission, res) {
  if (!isValidPermission(permission)) {
    badRequest(res, 'Invalid permission. Must be view, comment, edit, or admin.');
    return false;
  }
  return true;
}

// ============================================================
// PAGINATION PARSING
// ============================================================

/**
 * Parse pagination parameters from URL search params.
 * Provides consistent parsing with configurable defaults and limits.
 *
 * @param {URLSearchParams} searchParams - URL search parameters
 * @param {Object} [options] - Configuration options
 * @param {number} [options.defaultLimit=50] - Default limit if not specified
 * @param {number} [options.maxLimit=100] - Maximum allowed limit
 * @param {number} [options.minLimit=1] - Minimum allowed limit
 * @returns {{limit: number, offset: number}} - Parsed and clamped values
 */
export function parsePaginationParams(searchParams, options = {}) {
  const { defaultLimit = 50, maxLimit = 100, minLimit = 1 } = options;

  const rawLimit = searchParams.get('limit');
  const rawOffset = searchParams.get('offset');

  // Parse limit with clamping to [minLimit, maxLimit]
  const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : defaultLimit;
  const limit = Math.min(Math.max(parsedLimit || defaultLimit, minLimit), maxLimit);

  // Parse offset with minimum of 0
  const parsedOffset = rawOffset ? parseInt(rawOffset, 10) : 0;
  const offset = Math.max(parsedOffset || 0, 0);

  return { limit, offset };
}

// ============================================================
// DATE RANGE EXTRACTION
// ============================================================

/**
 * Extract and validate date range from search params.
 * Combines extraction and validation in one step.
 *
 * @param {URLSearchParams} searchParams - URL search parameters
 * @param {Object} [options] - Validation options (passed to validateDateRange)
 * @returns {{valid: boolean, since: string|null, until: string|null, error?: string}}
 */
export function extractDateRange(searchParams, options = {}) {
  const since = searchParams.get('since') ?? null;
  const until = searchParams.get('until') ?? null;

  const validation = validateDateRange(since, until, options);
  if (!validation.valid) {
    return { valid: false, since: null, until: null, error: validation.error };
  }

  return { valid: true, since, until };
}

/**
 * Extract and validate date range, sending error response if invalid.
 * Returns null if validation failed and error response was sent.
 *
 * @param {URLSearchParams} searchParams - URL search parameters
 * @param {Object} res - HTTP response object
 * @param {Object} [options] - Validation options
 * @param {Function} [options.sendError] - Custom error sender (default: badRequest)
 * @returns {{since: string|null, until: string|null}|null} - Date range or null if error
 */
export function extractValidatedDateRange(searchParams, res, options = {}) {
  const { sendError = badRequest, ...validationOptions } = options;

  const result = extractDateRange(searchParams, validationOptions);
  if (!result.valid) {
    sendError(res, result.error);
    return null;
  }

  return { since: result.since, until: result.until };
}