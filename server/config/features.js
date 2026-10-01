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
 * Legacy spellings of flags that were renamed to the enable form, recognized
 * (with a boot warning — see {@link deprecatedFlagWarnings}) until the removal
 * date. Removed in the first release after 2026-11-01; after that only the
 * canonical `*_ENABLED` vars exist.
 *
 * Maps old var → `{ name, inverted }`: the canonical var, and whether the old
 * one meant the opposite (`DISABLE_AI=true` is `AI_ENABLED=false`). The three
 * `DISABLE_*` kill switches came with B68; `NOTION_FEATURE` (same polarity,
 * wrong form) and `DISABLE_ANALYTICS` (which switches the external provider
 * scripts, not the analytics cluster) ride the same date (D259).
 */
const LEGACY_VARS = Object.freeze({
  DISABLE_AI: { name: 'AI_ENABLED', inverted: true },
  DISABLE_UPLOADS: { name: 'UPLOADS_ENABLED', inverted: true },
  DISABLE_IMAGE_LIBRARY: { name: 'IMAGE_LIBRARY_ENABLED', inverted: true },
  DISABLE_ANALYTICS: { name: 'EXTERNAL_ANALYTICS_ENABLED', inverted: true },
  NOTION_FEATURE: { name: 'NOTION_ENABLED', inverted: false },
});

/** Date after which the legacy spellings stop being recognized. */
const LEGACY_REMOVAL_DATE = '2026-11-01';

/**
 * Read an enable-form flag that still honors its legacy spelling.
 * Precedence: the canonical `*_ENABLED` var wins when set; else a set legacy
 * var is respected (inverted where it meant the opposite); else the default.
 * @param {string} name - Canonical enable-form env var
 * @param {boolean} defaultValue - The resting state
 * @returns {boolean}
 */
function envEnabledWithLegacy(name, defaultValue) {
  if (envStr(name)) return envBool(name, defaultValue);
  const legacy = Object.entries(LEGACY_VARS).find(([, v]) => v.name === name);
  if (legacy && envStr(legacy[0])) {
    const value = envBool(legacy[0]);
    return legacy[1].inverted ? !value : value;
  }
  return defaultValue;
}

/**
 * Multi-organization mode.
 * When enabled, an instance can hold several organizations that users switch between (the UI labels an organization "Workspace"); who may create one is `isMultiOrgUserCreateEnabled()`.
 * When disabled (default), the system operates in single-organization mode using the default organization.
 * @returns {boolean}
 */
export function isMultiOrgEnabled() {
  return envBool('MULTI_ORG_ENABLED');
}

/**
 * Whether any signed-in user may create an organization (B424).
 * On (default): `POST /api/organizations` is open to every user, as before.
 * Off: only instance admins may create one, for a pre-provisioned instance
 * where the operator creates each customer's organization and a customer who
 * made a second one would hold an organization outside any contract.
 * Only meaningful with `MULTI_ORG_ENABLED`.
 * @returns {boolean}
 */
export function isMultiOrgUserCreateEnabled() {
  return envBool('MULTI_ORG_USER_CREATE_ENABLED', true);
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
 * The first-party analytics cluster: view tracking, the dashboards and reports,
 * the weekly digest (`ANALYTICS_ENABLED=false` switches it off; D258). Default:
 * on. An installation flag, not the organization's `analytics.enabled` setting
 * or a deck's `analyticsEnabled`, which stay what an organization uses; and not
 * {@link isExternalAnalyticsEnabled}, the provider scripts in the app shell.
 * @returns {boolean}
 */
export function isAnalyticsEnabled() {
  return envBool('ANALYTICS_ENABLED', true);
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
  return envEnabledWithLegacy('AI_ENABLED', true);
}

/**
 * Direct file uploads. Default: on; the env var is a kill switch
 * (`UPLOADS_ENABLED=false`). @returns {boolean}
 */
export function isUploadsEnabled() {
  return envEnabledWithLegacy('UPLOADS_ENABLED', true);
}

/**
 * The built-in image library. Default: on; the env var is a kill switch
 * (`IMAGE_LIBRARY_ENABLED=false`). @returns {boolean}
 */
export function isImageLibraryEnabled() {
  return envEnabledWithLegacy('IMAGE_LIBRARY_ENABLED', true);
}

/**
 * Non-fatal boot warnings for legacy flag spellings. The old vars are still
 * respected (see {@link envEnabledWithLegacy}), but every set one gets a
 * warning naming the canonical `*_ENABLED` replacement and the removal date.
 * Returns [] when no legacy var is set.
 * @returns {string[]}
 */
export function deprecatedFlagWarnings() {
  const warnings = [];
  for (const [legacyName, { name, inverted }] of Object.entries(LEGACY_VARS)) {
    if (!envStr(legacyName)) continue;
    const enabled = inverted ? !envBool(legacyName) : envBool(legacyName);
    const replacement = `${name}=${enabled ? 'true' : 'false'}`;
    const overridden = envStr(name)
      ? ` (${name} is also set and takes precedence)`
      : '';
    warnings.push(
      `${legacyName} is deprecated and will be removed in the first release ` +
        `after ${LEGACY_REMOVAL_DATE}; set ${replacement} instead${overridden}.`,
    );
  }
  return warnings;
}

/**
 * The Notion integration: import, publish, fetch, status and the wizard's
 * subject picker — the whole `/api/notion/*` module. Default: off
 * (`NOTION_ENABLED=true` turns it on; `NOTION_SECRET` then says whether it is
 * configured). @returns {boolean}
 */
export function isNotionEnabled() {
  return envEnabledWithLegacy('NOTION_ENABLED', false);
}

/**
 * External analytics provider scripts in the app shell (Plausible, GA, a
 * custom snippet — `server/analytics/head.js`). Default: on; the providers
 * still need configuring. Not the first-party analytics cluster.
 * @returns {boolean}
 */
export function isExternalAnalyticsEnabled() {
  return envEnabledWithLegacy('EXTERNAL_ANALYTICS_ENABLED', true);
}
