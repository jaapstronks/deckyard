/**
 * Shared config utilities — the one accessor family for environment
 * variables. Every env read goes through envStr/envBool/envInt/envList so a
 * flag means the same thing wherever it is read (`1`/`true`/`yes`/`on` all
 * count as true, defaults live at the read site, and values are trimmed).
 */

/**
 * Read a string env var, trimmed. Unset or blank → fallback.
 * @param {string} name - Environment variable name
 * @param {string} [fallback]
 * @returns {string}
 */
export function envStr(name, fallback = '') {
  const v = process.env[name];
  const s = String(v == null ? '' : v).trim();
  return s || fallback;
}

/**
 * Read a boolean env var. `1`/`true`/`yes`/`on` (any case) → true, any other
 * set value → false, unset or blank → fallback.
 * @param {string} name - Environment variable name
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
export function envBool(name, fallback = false) {
  const s = envStr(name);
  if (!s) return !!fallback;
  const l = s.toLowerCase();
  return l === '1' || l === 'true' || l === 'yes' || l === 'on';
}

/**
 * Read an integer env var. Unset, blank, non-numeric, or outside the
 * min/max bounds → fallback.
 * @param {string} name - Environment variable name
 * @param {number} fallback
 * @param {{min?: number, max?: number}} [bounds]
 * @returns {number}
 */
export function envInt(name, fallback, { min, max } = {}) {
  const s = envStr(name);
  if (!s) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (min !== undefined && i < min) return fallback;
  if (max !== undefined && i > max) return fallback;
  return i;
}

/**
 * Read a comma/whitespace-separated env var as a lowercased, de-duplicated
 * list. Unset or blank → [].
 * @param {string} name - Environment variable name
 * @returns {string[]}
 */
export function envList(name) {
  return [
    ...new Set(
      envStr(name)
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
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
