import { api } from '../api.js';

/**
 * One place that knows which image sources beside the native library are
 * available. Three callers need the same answer at different moments — the
 * picker seam when it builds its provider list, the image library when it
 * decides which sidebar sections exist, and the admin panel for its
 * "configured" badges — and each fetching it separately meant the same request
 * three times and three spellings of the configured-AND-enabled rule.
 *
 * @typedef {Object} StockSourceStatus
 * @property {boolean} configured  Server-side prerequisites met (API key, assets).
 * @property {boolean} enabled     Admin toggle (`stockMedia.<id>.enabled`).
 */

let cached = null;
let cachedAt = 0;

/** Drop the memoised status (after an admin toggles a source). */
export function invalidateStockMediaStatus() {
  cached = null;
  cachedAt = 0;
}

/**
 * Fetch `/api/stock-media/status`, memoised. A failed request resolves to an
 * empty status and is *not* cached: no source is offered, and the next caller
 * retries rather than inheriting a minute of "nothing is available".
 *
 * @param {{ maxAgeMs?: number }} [opts]
 * @returns {Promise<Record<string, StockSourceStatus>>}
 */
export async function fetchStockMediaStatus({ maxAgeMs = 60_000 } = {}) {
  const now = Date.now();
  if (cached && now - cachedAt < maxAgeMs) return cached;
  let resp = null;
  try {
    resp = await api('/api/stock-media/status');
  } catch {
    return {};
  }
  cached = resp && typeof resp === 'object' ? resp : {};
  cachedAt = now;
  return cached;
}

/**
 * The one spelling of "this source is usable": the server has what it needs
 * *and* an admin turned it on.
 *
 * @param {Record<string, StockSourceStatus>|null} status
 * @param {string} id - 'bundled' | 'unsplash' | 'giphy'
 * @returns {boolean}
 */
export function isStockSourceAvailable(status, id) {
  const p = status?.[id];
  return !!(p?.configured && p?.enabled);
}

/**
 * Fetch the bundled gradient manifest. Only meaningful when
 * `isStockSourceAvailable(status, 'bundled')` — the route 400s otherwise.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function fetchBundledGradients() {
  const resp = await api('/api/stock-media/bundled/manifest');
  return Array.isArray(resp?.items) ? resp.items : [];
}
