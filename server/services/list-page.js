/**
 * The list-page contract: one shape for every list that grows per
 * organization (D358, brief `db-level-pagination.md`).
 *
 * In: `{ limit, cursor }` — query parameters on the internal API and v1, tool
 * arguments in MCP. Out: `{ <collection>: [...], nextCursor }`, where
 * `nextCursor: null` means the list has ended. Every list has exactly one
 * order, `(<time> desc, id desc)`; storage applies it through
 * `server/storage/keyset.js`, which receives the decoded position, never the
 * cursor string.
 *
 * What this module refuses, as a 400 `invalid` naming `details.field`:
 *
 *  - a `limit` outside 1..100 or not an integer. It is not clamped: a silent
 *    100 for `limit=500` is the tolerance the beta doctrine refuses;
 *  - any `offset` (`details.use = 'cursor'`): one form, not two side by side;
 *  - a cursor that does not decode, has another version, belongs to another
 *    order or was made under other filters. The cursor carries a short
 *    fingerprint of the normalized filters, so a cursor replayed with
 *    different filters is refused instead of answering a silently wrong page.
 *    Filters are sent again with every page; the cursor carries only the
 *    position.
 *
 * The cursor grants nothing: it holds a sort value and an id the reader
 * already saw, and every follow-up query applies the caller's scope again. It
 * is therefore not signed.
 *
 * @module server/services/list-page
 */

import crypto from 'node:crypto';

import { AppError } from '../utils/errors.js';
import { isUuid } from '../utils/uuid.js';

/** The largest page any surface may ask for. */
export const LIST_PAGE_MAX_LIMIT = 100;

/**
 * The page size when the caller names none. A surface may choose a smaller
 * default, never a larger one, and never another maximum.
 */
export const LIST_PAGE_DEFAULT_LIMIT = 50;

const CURSOR_VERSION = 1;

/**
 * A sort value as `keyset.js` reads it out of SQL (`<column>::text`): a
 * timestamp with up to microsecond precision and an offset. Anything else
 * would reach `::timestamptz` and fail as a 500.
 */
const SORT_VALUE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2})(?::?(\d{2}))?)$/;

/**
 * Check calendar, clock and PostgreSQL numeric-offset bounds without
 * converting the sort value to a Date (which would lose microseconds).
 * @param {string} value
 * @returns {boolean}
 */
function validSortValue(value) {
  const parts = SORT_VALUE_RE.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    parts.slice(1).map((part) => Number(part ?? 0));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 15 &&
    offsetMinute <= 59
  );
}

/**
 * @typedef {Object} ListPosition
 * @property {string} value - Sort value of the last row seen, as SQL text.
 * @property {string} id - Id of the last row seen (the unique tiebreaker).
 */

/**
 * @typedef {Object} ListPage
 * @property {number} limit - Rows per page, 1..100.
 * @property {ListPosition|null} after - Where the page starts; null = the top.
 * @property {string} sortKey - Name of the list's one order.
 * @property {string} fingerprint - Hash of the normalized filters.
 */

/**
 * Refuse one input as the canonical 400 `invalid`.
 * @param {string} field
 * @param {string} message
 * @param {Object} [extra] - More details (`use`).
 * @returns {never}
 */
function refuse(field, message, extra = {}) {
  throw new AppError(message, 400, { field, ...extra }, 'invalid');
}

/**
 * Read one input key from query parameters or a plain argument object.
 * @param {URLSearchParams|Object|null|undefined} input
 * @param {string} key
 * @returns {{present: boolean, value: *}}
 */
function readInput(input, key) {
  if (!input) return { present: false, value: undefined };
  if (typeof input.get === 'function' && typeof input.has === 'function') {
    return { present: input.has(key), value: input.get(key) };
  }
  return { present: Object.hasOwn(input, key), value: input[key] };
}

/**
 * The fingerprint of a list's filters: a short hash over the normalized
 * (key-sorted, empty-dropped) filter object.
 * @param {Object<string, *>} [filters]
 * @returns {string}
 */
function fingerprintFilters(filters = {}) {
  const normalized = Object.keys(filters)
    .sort()
    .filter((key) => filters[key] !== undefined && filters[key] !== null)
    .map((key) => [key, filters[key]]);
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('base64url')
    .slice(0, 16);
}

/**
 * @param {*} raw
 * @param {number} defaultLimit
 * @returns {number}
 */
function parseLimit(raw, defaultLimit) {
  if (raw === undefined || raw === null || raw === '') return defaultLimit;
  const text = String(raw);
  const limit = /^\d+$/.test(text) ? Number(text) : NaN;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > LIST_PAGE_MAX_LIMIT ||
    (typeof raw !== 'string' && typeof raw !== 'number')
  ) {
    refuse(
      'limit',
      `Invalid limit: use a whole number from 1 to ${LIST_PAGE_MAX_LIMIT}`,
    );
  }
  return limit;
}

/**
 * @param {*} raw
 * @param {string} sortKey
 * @param {string} fingerprint
 * @returns {ListPosition|null}
 */
function parseCursor(raw, sortKey, fingerprint) {
  if (raw === undefined || raw === null || raw === '') return null;
  let decoded = null;
  if (typeof raw === 'string') {
    try {
      decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      decoded = null;
    }
  }
  const key = Array.isArray(decoded?.k) ? decoded.k : [];
  const readable =
    decoded?.v === CURSOR_VERSION &&
    key.length === 2 &&
    typeof key[0] === 'string' &&
    validSortValue(key[0]) &&
    isUuid(key[1]);
  if (!readable) refuse('cursor', 'Invalid cursor');
  if (decoded.s !== sortKey) {
    refuse('cursor', 'This cursor belongs to another list');
  }
  if (decoded.f !== fingerprint) {
    refuse(
      'cursor',
      'This cursor was made with other filters; send the same filters again',
    );
  }
  return { value: key[0], id: key[1] };
}

/**
 * Read and check one page request: the bounds on `limit`, the refusal of
 * `offset`, and the cursor against this list's order and filters.
 *
 * @param {URLSearchParams|Object|null|undefined} input - Query parameters or
 *   tool arguments carrying `limit`, `cursor` (and a refused `offset`).
 * @param {Object} options
 * @param {string} options.sortKey - Name of the list's order (`created_desc`).
 * @param {Object<string, *>} [options.filters] - The normalized filters this
 *   page is read under; a cursor made under others is refused.
 * @param {number} [options.defaultLimit] - Page size when none is named
 *   (1..50).
 * @returns {ListPage}
 * @throws {AppError} 400 `invalid` with `details.field` `limit`, `offset` or
 *   `cursor`.
 */
export function parseListPage(input, options) {
  const {
    sortKey,
    filters = {},
    defaultLimit = LIST_PAGE_DEFAULT_LIMIT,
  } = options;
  if (!sortKey) throw new Error('parseListPage: a sortKey is required');
  if (
    !Number.isInteger(defaultLimit) ||
    defaultLimit < 1 ||
    defaultLimit > LIST_PAGE_DEFAULT_LIMIT
  ) {
    throw new Error(`parseListPage: defaultLimit ${defaultLimit} out of range`);
  }

  if (readInput(input, 'offset').present) {
    refuse('offset', 'Unknown parameter "offset": use "cursor"', {
      use: 'cursor',
    });
  }
  const limit = parseLimit(readInput(input, 'limit').value, defaultLimit);
  const fingerprint = fingerprintFilters(filters);
  const after = parseCursor(
    readInput(input, 'cursor').value,
    sortKey,
    fingerprint,
  );
  return { limit, after, sortKey, fingerprint };
}

/**
 * Encode the position after the last row of a page as an opaque cursor for
 * the same list and filters.
 *
 * @param {ListPage} page - The page the position was read under.
 * @param {ListPosition} position
 * @returns {string}
 */
export function encodeCursor(page, position) {
  return Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      s: page.sortKey,
      f: page.fingerprint,
      k: [position.value, position.id],
    }),
  ).toString('base64url');
}

/**
 * The output shape of a list page: the collection under its own name and the
 * cursor for the next page, or `null` at the end.
 *
 * @template T
 * @param {string} collection - The list's name (`notifications`, …).
 * @param {{items: T[], next: ListPosition|null}} result - What
 *   `keysetRows()` returned.
 * @param {ListPage} page
 * @returns {Object<string, T[]|string|null>}
 */
export function listPageResult(collection, result, page) {
  return {
    [collection]: result.items,
    nextCursor: result.next ? encodeCursor(page, result.next) : null,
  };
}
