/**
 * Request parameter validation utilities.
 * Extracts and validates common request body fields.
 */

import { validateDateRange } from './normalize.js';
import { badRequest } from './http.js';
import { isValidPermission as _isValidPermission } from '../../shared/constants/permissions.js';
import { normalizeLang } from '../../shared/i18n-utils.js';

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
 * Extract and validate a deck-language field, or null.
 *
 * Membership is `normalizeLang()` from `shared/i18n-utils.js` — the one test on
 * the deck-language axis. This used to hardcode `val === 'nl' || val ===
 * 'en-GB'`, the sixth spelling of a list that was declared in five other places
 * (D61); a request naming any other axis language was silently dropped here
 * while the storage layer would have stored it.
 *
 * An unsupported tag reads as null, the same as an absent field. A create
 * route therefore refuses one with `assertCreatableDeckInput()` before it reads
 * the field (B576); the routes that edit an existing deck read it here.
 *
 * @param {object} body - Request body
 * @param {string} [key='lang'] - Field name
 * @returns {string|null}
 */
export function getLang(body, key = 'lang') {
  return normalizeLang(body?.[key]);
}

/**
 * Extract a deck-language field for the conversion pipeline, which spells
 * "detect it" as `'auto'`: an absent field becomes `'auto'`. On the wire the
 * one spelling of "detect" is an absent `lang`; a create route refuses an
 * unsupported tag, `'auto'` included, with `assertCreatableDeckInput()` before
 * it reads the field (B576), so the fallback here never hides one.
 * @param {object} body - Request body
 * @param {string} [key='lang'] - Field name
 * @returns {string}
 */
export function getLangOrAuto(body, key = 'lang') {
  return normalizeLang(body?.[key]) || 'auto';
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
 * Extract an optional boolean field, distinguishing "present" from "absent".
 * Returns null when the field is missing or not a boolean, so a caller can
 * branch on whether the client sent it at all (which `getBoolean`'s default
 * hides).
 * @param {object} body - Request body
 * @param {string} key - Field name
 * @returns {boolean|null}
 */
export function getOptionalBoolean(body, key) {
  const val = body?.[key];
  return typeof val === 'boolean' ? val : null;
}

/**
 * Extract an optional non-negative number field.
 * Returns null unless the field is a number `>= 0` (e.g. an insertion index).
 * @param {object} body - Request body
 * @param {string} key - Field name
 * @returns {number|null}
 */
export function getNonNegativeNumber(body, key) {
  const val = body?.[key];
  return typeof val === 'number' && val >= 0 ? val : null;
}

/**
 * Extract an optional data-URL string field.
 * Returns the value only when it is a string beginning with `data:`, else null;
 * the caller decides the 400. Does not validate the media type or base64 body.
 * @param {object} body - Request body
 * @param {string} key - Field name
 * @returns {string|null}
 */
export function getDataUrl(body, key) {
  const val = body?.[key];
  return typeof val === 'string' && val.startsWith('data:') ? val : null;
}

/**
 * Extract an array-of-strings field, dropping every non-string and empty entry.
 * With `{ trim: true }` each entry is trimmed before the emptiness test. Returns
 * `[]` when the field is missing or not an array.
 * @param {object} body - Request body
 * @param {string} key - Field name
 * @param {object} [options]
 * @param {boolean} [options.trim=false] - Trim entries before dropping empties
 * @returns {string[]}
 */
export function getStringArray(body, key, { trim = false } = {}) {
  const val = body?.[key];
  if (!Array.isArray(val)) return [];
  const out = [];
  for (const entry of val) {
    if (typeof entry !== 'string') continue;
    const s = trim ? entry.trim() : entry;
    if (s) out.push(s);
  }
  return out;
}

/**
 * Extract common AI endpoint parameters.
 * @param {object} body - Request body
 * `theme` is passed on as sent: `settleNewDeckTheme` decides it (B486).
 * @returns {{ raw: string, vendor: string|null, lang: string|null, theme: unknown, settings: object|null }}
 */
export function getAiParams(body) {
  return {
    raw: getString(body, 'raw'),
    vendor: getOptionalString(body, 'vendor'),
    lang: getLang(body),
    theme: body?.theme,
    settings: getOptionalObject(body, 'settings'),
  };
}

/**
 * Extract common file conversion parameters.
 * @param {object} body - Request body
 * `theme` is passed on as sent: `settleNewDeckTheme` decides it (B486).
 * @returns {{ dataUrl: string, filename: string, vendor: string|null, lang: string, theme: unknown }}
 */
export function getConvertParams(body) {
  return {
    dataUrl: getString(body, 'dataUrl'),
    filename: getString(body, 'filename'),
    vendor: getOptionalString(body, 'vendor'),
    lang: getLangOrAuto(body),
    theme: body?.theme,
  };
}

// ============================================================
// PERMISSION VALIDATION
// ============================================================

/**
 * Validate a permission string.
 * Re-exported from shared/constants/permissions.js for backwards compatibility.
 * @param {string} permission - The permission to validate
 * @returns {boolean} - True if valid
 */
const isValidPermission = _isValidPermission;

/**
 * Validate permission and send badRequest if invalid.
 * @param {string} permission - The permission to validate
 * @param {Object} res - HTTP response object
 * @returns {boolean} - True if valid, false if error response was sent
 */
export function validatePermission(permission, res) {
  if (!isValidPermission(permission)) {
    badRequest(
      res,
      'Invalid permission. Must be view, comment, edit, or admin.',
    );
    return false;
  }
  return true;
}

// ============================================================
// PAGINATION PARSING
// ============================================================

/**
 * A boolean query flag as a service reads it: `true`/`false`, absent as
 * `undefined`, and any other value passed on unchanged so the service refuses
 * it with the field named, instead of this parser reading it as "off".
 *
 * @param {URLSearchParams} searchParams
 * @param {string} key
 * @returns {boolean|string|undefined}
 */
export function parseQueryFlag(searchParams, key) {
  const raw = searchParams.get(key);
  if (raw === null) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

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
  const limit = Math.min(
    Math.max(parsedLimit || defaultLimit, minLimit),
    maxLimit,
  );

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
function extractDateRange(searchParams, options = {}) {
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
