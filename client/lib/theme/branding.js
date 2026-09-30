/**
 * Client-side branding accessors.
 *
 * The app name comes from the served shell: the server writes `APP_NAME` into
 * `<meta name="application-name">` before any script runs
 * (`injectAppName` in server/routes/static/app-shell.js), so it is right on
 * every route, including the sign-in screens that never fetch /me. The help URL
 * and the logo ride in the feature-flags payload (`features.branding`, see
 * server/config/branding.js); these helpers read them back with safe defaults
 * so unauthenticated / audience-facing views still render the upstream brand.
 */

import { getFeatures } from '../state/features.js';

const DEFAULT_APP_NAME = 'Deckyard';

/**
 * The configured application name, or the "Deckyard" default.
 * @returns {string}
 */
export function getAppName() {
  const v = document
    .querySelector('meta[name="application-name"]')
    ?.getAttribute('content');
  return typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_APP_NAME;
}

/**
 * The configured help/docs URL, or null when unset.
 * @returns {string|null}
 */
export function getHelpUrl() {
  const v = getFeatures()?.branding?.helpUrl;
  return typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null;
}

/**
 * The instance logo (`APP_LOGO_URL`), or null when the upstream logo applies.
 * @returns {string|null}
 */
export function getAppLogoUrl() {
  const v = getFeatures()?.branding?.logoUrl;
  return typeof v === 'string' && v ? v : null;
}

/**
 * Set the browser tab title. Pass a page/context label to get
 * "Label - AppName"; pass nothing (or empty) for just the app name.
 * @param {string} [label]
 */
export function setDocumentTitle(label) {
  const appName = getAppName();
  const clean = typeof label === 'string' ? label.trim() : '';
  document.title = clean ? `${clean} - ${appName}` : appName;
}
