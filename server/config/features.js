/**
 * Feature flag declarations — the single place where a feature env var is
 * read. Every flag is a call-time function (never a module-load constant) so
 * `.env` loading order can't bite; `config/flags-snapshot.js` aggregates
 * these into the client-facing snapshot.
 *
 * Naming: every on/off flag carries the enable form (`X_ENABLED`) — the
 * default carries the resting state, the polarity never flips. See
 * docs/reference/feature-flags.md (B68).
 */

import { envBool, envStr } from './utils.js';

/**
 * Legacy disable-form spellings of the three kill switches, recognized (with
 * a boot warning — see {@link deprecatedFlagWarnings}) until the removal
 * date. Removed in the first release after 2026-11-01; after that only the
 * enable-form vars exist. Maps old var → canonical `*_ENABLED` var.
 */
const LEGACY_DISABLE_VARS = Object.freeze({
  DISABLE_AI: 'AI_ENABLED',
  DISABLE_UPLOADS: 'UPLOADS_ENABLED',
  DISABLE_IMAGE_LIBRARY: 'IMAGE_LIBRARY_ENABLED',
});

/** Date after which the legacy `DISABLE_*` spellings stop being recognized. */
const LEGACY_DISABLE_REMOVAL_DATE = '2026-11-01';

/**
 * Read an enable-form flag that still honors its legacy disable-form
 * spelling. Precedence: the canonical `*_ENABLED` var wins when set; else a
 * set legacy `DISABLE_*` var is respected (inverted); else the feature
 * defaults to on.
 * @param {string} name - Canonical enable-form env var
 * @param {string} legacyName - Deprecated disable-form env var
 * @returns {boolean}
 */
function envEnabledWithLegacy(name, legacyName) {
  if (envStr(name)) return envBool(name, true);
  if (envStr(legacyName)) return !envBool(legacyName);
  return true;
}

/**
 * Multi-organization mode.
 * When enabled, an instance can hold several organizations that users can create and switch between (the UI labels an organization "Workspace").
 * When disabled (default), the system operates in single-organization mode using the default organization.
 * @returns {boolean}
 */
export function isMultiOrgEnabled() {
  return envBool('MULTI_ORG_ENABLED');
}

/**
 * Live data sources.
 * When enabled, slides can connect to external data sources (Notion, CSV, etc.)
 * and display live or periodically refreshed data.
 * @returns {boolean}
 */
export function isLiveDataEnabled() {
  return envBool('LIVE_DATA_ENABLED');
}

/**
 * Real-time collaboration (presence) configuration.
 * When enabled, the server mounts a Yjs/Hocuspocus WebSocket endpoint at
 * /collab and the editor shows live collaborator presence. Default: off —
 * single-user installs run without any collaboration transport.
 * @returns {boolean}
 */
export function isCollabEnabled() {
  return envBool('COLLAB_ENABLED');
}

/**
 * Real-time collaboration (live document edits) configuration.
 * Phase 2 on top of presence: the Y.Doc becomes the live source of truth
 * while a deck is open collaboratively — persisted server-side and
 * serialized back to the deck JSON. Requires COLLAB_ENABLED; kept as a
 * separate flag so presence can ship and soak alone. Default: off.
 * @returns {boolean}
 */
export function isCollabLiveEditsEnabled() {
  return isCollabEnabled() && envBool('COLLAB_LIVE_EDITS');
}

/**
 * RSS Feed configuration.
 * When enabled, organizations can activate RSS/Atom/JSON feeds for published presentations.
 * Default: true (enabled). The env var is a kill switch for instances that don't want the feature.
 * The org-level toggle (settings.rss.enabled) is the real user-facing gate.
 * @returns {boolean}
 */
export function isRssFeedEnabled() {
  return envBool('RSS_FEED_ENABLED', true);
}

/**
 * Demo mode: a read-mostly showcase install (sample decks, no AI, no
 * uploads). @returns {boolean}
 */
export function isDemoMode() {
  return envBool('DEMO_MODE');
}

/**
 * ImageKit-only media: the instance serves images exclusively from the
 * ImageKit DAM — local uploads and the image library are off.
 * @returns {boolean}
 */
export function isImagekitOnly() {
  return envBool('IMAGEKIT_ONLY');
}

/**
 * AI features (generation, refinement, alt-text). Default: on; the env var
 * is a kill switch (`AI_ENABLED=false`).
 * @returns {boolean}
 */
export function isAiEnabled() {
  return envEnabledWithLegacy('AI_ENABLED', 'DISABLE_AI');
}

/**
 * Direct file uploads. Default: on; the env var is a kill switch
 * (`UPLOADS_ENABLED=false`). @returns {boolean}
 */
export function isUploadsEnabled() {
  return envEnabledWithLegacy('UPLOADS_ENABLED', 'DISABLE_UPLOADS');
}

/**
 * The built-in image library. Default: on; the env var is a kill switch
 * (`IMAGE_LIBRARY_ENABLED=false`). @returns {boolean}
 */
export function isImageLibraryEnabled() {
  return envEnabledWithLegacy('IMAGE_LIBRARY_ENABLED', 'DISABLE_IMAGE_LIBRARY');
}

/**
 * Non-fatal boot warnings for legacy `DISABLE_*` kill-switch spellings.
 * The old vars are still respected (see {@link envEnabledWithLegacy}), but
 * every set one gets a warning naming the canonical `*_ENABLED` replacement
 * and the removal date. Returns [] when no legacy var is set.
 * @returns {string[]}
 */
export function deprecatedFlagWarnings() {
  const warnings = [];
  for (const [legacyName, name] of Object.entries(LEGACY_DISABLE_VARS)) {
    if (!envStr(legacyName)) continue;
    const replacement = `${name}=${envBool(legacyName) ? 'false' : 'true'}`;
    const overridden = envStr(name)
      ? ` (${name} is also set and takes precedence)`
      : '';
    warnings.push(
      `${legacyName} is deprecated and will be removed in the first release ` +
        `after ${LEGACY_DISABLE_REMOVAL_DATE}; set ${replacement} instead${overridden}.`,
    );
  }
  return warnings;
}

/**
 * Notion import/export integration. Default: off. @returns {boolean}
 */
export function isNotionFeatureEnabled() {
  return envBool('NOTION_FEATURE');
}
