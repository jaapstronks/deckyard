/**
 * Shared string utilities
 */

/**
 * Clean and trim a string value, optionally truncating to max length
 * @param {*} v - Value to clean
 * @param {Object} [options]
 * @param {number} [options.max] - Maximum length (optional)
 * @returns {string} Trimmed string or empty string
 */
export function cleanStr(v, { max } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  return max ? s.slice(0, max) : s;
}

/**
 * Clean and lowercase a string
 * @param {*} v - Value to process
 * @returns {string} Lowercase trimmed string
 */
export function lower(v) {
  return cleanStr(v).toLowerCase();
}

/**
 * Get unique non-empty strings from an array
 * @param {Array} arr - Array of values
 * @returns {string[]} Array of unique trimmed strings
 */
export function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(arr) ? arr : []) {
    const s = cleanStr(raw);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}