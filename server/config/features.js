/**
 * Feature flag declarations — the single place where a feature env var is
 * read. Every flag is a call-time function (never a module-load constant) so
 * `.env` loading order can't bite; `config/flags-snapshot.js` aggregates
 * these into the client-facing snapshot.
 */

import { envBool } from './utils.js';

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
 * Kill switch for all AI features (generation, refinement, alt-text).
 * @returns {boolean}
 */
export function isAiDisabled() {
  return envBool('DISABLE_AI');
}

/**
 * Kill switch for file uploads. @returns {boolean}
 */
export function isUploadsDisabled() {
  return envBool('DISABLE_UPLOADS');
}

/**
 * Kill switch for the built-in image library. @returns {boolean}
 */
export function isImageLibraryDisabled() {
  return envBool('DISABLE_IMAGE_LIBRARY');
}

/**
 * Notion import/export integration. Default: off. @returns {boolean}
 */
export function isNotionFeatureEnabled() {
  return envBool('NOTION_FEATURE');
}
