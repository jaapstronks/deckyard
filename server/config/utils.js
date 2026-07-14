/**
 * Shared config utilities.
 */

export function truthy(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * Resolve the application's public base URL.
 * Checks APP_URL, then constructs from DOMAIN, then falls back to empty string.
 * @returns {string} Absolute base URL (no trailing slash) or empty string
 */
export function getAppBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.DOMAIN) return `https://${process.env.DOMAIN}`;
  return '';
}
