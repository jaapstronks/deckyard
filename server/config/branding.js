/**
 * Branding configuration.
 *
 * White-label knobs so a fork or deployment can present its own name and
 * documentation without patching code. Both are read at call time (not module
 * load) so .env loading order can't bite.
 *
 * - APP_NAME: the product name shown in the browser tab title, the logo alt
 *   text, and email sender fallbacks. Defaults to "Deckyard".
 * - HELP_URL: absolute URL for the in-app "Help / Docs" link. When unset the
 *   link is hidden (no default — there is no canonical docs site baked in).
 */

const DEFAULT_APP_NAME = 'Deckyard';

/**
 * The configured application name, or the default.
 * @returns {string}
 */
export function getAppName() {
  const v = (process.env.APP_NAME || '').trim();
  return v || DEFAULT_APP_NAME;
}

/**
 * The configured help/docs URL, or null when unset.
 * Only absolute http(s) URLs are honored; anything else is treated as unset.
 * @returns {string|null}
 */
export function getHelpUrl() {
  const v = (process.env.HELP_URL || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return null;
  return v;
}

/**
 * Branding config for the client (served with the feature flags).
 * @returns {{ appName: string, helpUrl: string|null }}
 */
export function getBranding() {
  return { appName: getAppName(), helpUrl: getHelpUrl() };
}
