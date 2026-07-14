/**
 * ImageKit URL transformation utilities
 */

import { cleanStr, uniqStrings as uniq } from '../../../../shared/string-utils.js';

export { cleanStr, uniq };

/**
 * Add a raw transformation query parameter to an ImageKit URL
 * @param {string} url - The base URL
 * @param {string} tr - The transformation string (e.g., 'w-520,h-320')
 * @returns {string} URL with transformation parameter
 */
export function addTr(url, tr) {
  const u = cleanStr(url);
  if (!u) return '';
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}tr=${encodeURIComponent(tr)}`;
}

/**
 * Add a named transformation to an ImageKit URL
 * @param {string} url - The base URL
 * @param {string} name - The named transformation ID
 * @returns {string} URL with named transformation parameter
 */
export function addNamedTr(url, name) {
  const u = cleanStr(url);
  if (!u) return '';
  const tr = cleanStr(name) ? `n-${cleanStr(name)}` : '';
  if (!tr) return u;
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}tr=${encodeURIComponent(tr)}`;
}

/**
 * Build a best-effort tag from config and document ID
 * @param {Object} cfg - Configuration object with tagPrefix
 * @param {string} docId - Document ID
 * @returns {string} Combined tag or empty string
 */
export function buildDocTag(cfg, docId) {
  const tagPrefix = cleanStr(cfg?.tagPrefix);
  const id = cleanStr(docId);
  if (!tagPrefix || !id) return '';
  return `${tagPrefix}${id}`;
}