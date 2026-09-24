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
 * - APP_LOGO_URL: the instance's own logo, shown in the overview topbar
 *   (instead of the Deckyard logo) and above the sign-in card (which shows no
 *   logo when unset). An absolute http(s) URL or a root-relative path such as
 *   `/custom/assets/images/logo.svg`.
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
 * Whether a logo value is one this installation can serve as an image source:
 * an absolute http(s) URL or a root-relative path (not protocol-relative).
 * @param {string} v
 * @returns {boolean}
 */
function isLogoUrl(v) {
  return /^https?:\/\//i.test(v) || (v.startsWith('/') && !v.startsWith('//'));
}

/**
 * The configured instance logo, or null when unset or unusable.
 * @returns {string|null}
 */
export function getAppLogoUrl() {
  const v = (process.env.APP_LOGO_URL || '').trim();
  return v && isLogoUrl(v) ? v : null;
}

/**
 * Boot warnings for branding values that are set but unusable. They do not
 * block boot (a missing logo or help link is cosmetic), but an operator who
 * set one should hear why it does not show instead of finding out on screen.
 * @returns {string[]}
 */
export function brandingConfigWarnings() {
  const warnings = [];
  const help = (process.env.HELP_URL || '').trim();
  if (help && !getHelpUrl()) {
    warnings.push(
      `HELP_URL="${help}" is not an absolute http(s) URL; the help link stays hidden.`,
    );
  }
  const logo = (process.env.APP_LOGO_URL || '').trim();
  if (logo && !getAppLogoUrl()) {
    warnings.push(
      `APP_LOGO_URL="${logo}" is neither an absolute http(s) URL nor a root-relative path; the default logo is shown.`,
    );
  }
  return warnings;
}

/**
 * Branding config for the client: served with the feature flags, and with the
 * public sign-in config for the auth pages (which have no session to fetch
 * the flags with).
 * @returns {{ appName: string, helpUrl: string|null, logoUrl: string|null }}
 */
export function getBranding() {
  return {
    appName: getAppName(),
    helpUrl: getHelpUrl(),
    logoUrl: getAppLogoUrl(),
  };
}
