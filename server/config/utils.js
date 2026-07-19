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

/**
 * Non-fatal startup warnings about public-URL configuration. When neither
 * APP_URL nor DOMAIN is set, getAppBaseUrl() returns '' and every absolute
 * link the server emits (share URLs, OG/social tags, e-mail links) ends up
 * empty or relative. Returns [] when a public base URL is configured.
 * @returns {string[]}
 */
export function publicUrlWarnings() {
  if (getAppBaseUrl()) return [];
  return [
    'Neither APP_URL nor DOMAIN is set; absolute links (share URLs, OG tags, ' +
      'e-mail links) will be empty or wrong. Set APP_URL to your public origin.',
  ];
}
