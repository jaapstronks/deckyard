/**
 * Charset validation for third-party analytics identifiers and endpoints.
 *
 * Every value in this module ends up interpolated into the `<head>` of the
 * app shell, of **every published deck** and of **every embed**
 * (`server/analytics/head.js`), part of it inside a `<script>` block. HTML
 * escaping is the wrong tool there — entities are not decoded inside script
 * content, so escaping both corrupts legitimate values and fails to contain a
 * quote that breaks out of a JS string literal. The containment is therefore a
 * charset check at both ends: the write path drops a value that cannot be
 * spelled safely (`server/storage/settings.js`), and the render path refuses to
 * emit a provider whose values did not survive (env vars included, since those
 * bypass the settings normalizer entirely).
 *
 * The patterns are deliberately the provider's own documented id format, not a
 * blocklist of dangerous characters.
 */

/**
 * One pattern per third-party identifier. Anchored, length-capped, and free of
 * quotes, angle brackets and whitespace by construction.
 */
export const PROVIDER_ID_PATTERNS = Object.freeze({
  /** Matomo site ids are integers. */
  matomoSiteId: /^[0-9]{1,32}$/,
  /** Umami website ids are UUIDs; allow the same alphabet without the dashes. */
  umamiWebsiteId: /^[A-Za-z0-9-]{1,64}$/,
  /** One hostname, or Plausible's documented comma-separated list of them. */
  plausibleDomain: /^[A-Za-z0-9.-]{1,255}(?:,[A-Za-z0-9.-]{1,255})*$/,
  /** GA4 measurement ids: `G-` plus an alphanumeric tail. */
  ga4MeasurementId: /^G-[A-Za-z0-9]{1,30}$/i,
  /** GTM container ids: `GTM-` plus an alphanumeric tail. */
  gtmContainerId: /^GTM-[A-Za-z0-9]{1,30}$/i,
});

/** Characters that could escape an attribute, a JS string literal or a tag. */
const UNSAFE_URL_CHARS = /['"<>`\\\s]/;

/**
 * Whether a third-party identifier is spelled the way its provider spells it.
 *
 * @param {keyof typeof PROVIDER_ID_PATTERNS} kind - Which identifier
 * @param {unknown} value - Candidate value
 * @returns {boolean} True when the trimmed value matches the provider pattern
 */
export function isValidProviderId(kind, value) {
  const pattern = PROVIDER_ID_PATTERNS[kind];
  if (!pattern) throw new Error(`unknown provider id kind: ${kind}`);
  return pattern.test(String(value ?? '').trim());
}

/**
 * The trimmed identifier, or `''` when it is not a valid one.
 *
 * Dropping rather than throwing matches every other normalizer in
 * `server/storage/settings.js` (`normalizeProviderUrl`, `normalizeThemeId`): the
 * PUT echoes the stored settings back, so a rejected value is visible as an
 * empty field instead of a saved one.
 *
 * @param {keyof typeof PROVIDER_ID_PATTERNS} kind - Which identifier
 * @param {unknown} value - Candidate value
 * @returns {string} The identifier, or '' when invalid
 */
export function normalizeProviderId(kind, value) {
  const s = String(value ?? '').trim();
  return isValidProviderId(kind, s) ? s : '';
}

/**
 * Whether a URL is safe to interpolate into head markup and script literals.
 *
 * `new URL()` alone is not enough: it leaves `'` unencoded in a path, which is
 * exactly the character that breaks out of Matomo's `var u="…"` neighbours.
 *
 * @param {unknown} value - Candidate URL
 * @returns {boolean} True for an http(s) URL free of quoting characters
 */
export function isEmbeddableUrl(value) {
  const s = String(value ?? '').trim();
  if (!s || s.length > 2048) return false;
  if (UNSAFE_URL_CHARS.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
