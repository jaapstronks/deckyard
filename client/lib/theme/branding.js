/**
 * Client-side branding accessors.
 *
 * The server ships branding config inside the feature-flags payload
 * (`features.branding`, see server/config/branding.js). These helpers read it
 * back with safe defaults so unauthenticated / audience-facing views that
 * never fetched /me still render the upstream brand.
 */

import { getFeatures } from '../state/features.js';

const DEFAULT_APP_NAME = 'Deckyard';

/**
 * The configured application name, or the "Deckyard" default.
 * @returns {string}
 */
export function getAppName() {
  const v = getFeatures()?.branding?.appName;
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
 * Set the browser tab title. Pass a page/context label to get
 * "Label - AppName"; pass nothing (or empty) for just the app name.
 * @param {string} [label]
 */
export function setDocumentTitle(label) {
  const appName = getAppName();
  const clean = typeof label === 'string' ? label.trim() : '';
  document.title = clean ? `${clean} - ${appName}` : appName;
}
