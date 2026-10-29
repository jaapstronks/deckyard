/**
 * An export route's URL with its language and, for the slide PDF and the PNG
 * ZIP, the slide selection (`?slides=1,3-5`, B871; read by the server).
 *
 * @param {string} path
 * @param {string|null} lang
 * @param {{ slides?: string|null }} [opts]
 * @returns {string}
 */
export function buildExportUrl(path, lang, { slides = null } = {}) {
  const u = new URL(path, location.origin);
  if (lang) u.searchParams.set('lang', String(lang));
  if (slides !== null) u.searchParams.set('slides', slides);
  return u.pathname + (u.search || '');
}
