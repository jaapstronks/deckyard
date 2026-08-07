/**
 * Feature configuration for multi-organization support.
 * These features are gated by environment variables.
 */

import { truthy } from './utils.js';

/**
 * Multi-organization mode configuration.
 * When enabled, an instance can hold several organizations that users can create and switch between (the UI labels an organization "Workspace").
 * When disabled (default), the system operates in single-organization mode using the default organization.
 */
export const MULTI_ORG_ENABLED = truthy(process.env.MULTI_ORG_ENABLED);

/**
 * Check if multi-organization features are enabled.
 * @returns {boolean}
 */
export function isMultiOrgEnabled() {
  return MULTI_ORG_ENABLED;
}

/**
 * Guard function that throws if multi-organization mode is not enabled.
 * Use this to protect routes that should only be available in multi-organization mode.
 */
export function requireMultiOrg() {
  if (!MULTI_ORG_ENABLED) {
    const error = new Error('Multi-organization features are not enabled');
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Live data sources configuration.
 * When enabled, slides can connect to external data sources (Notion, CSV, etc.)
 * and display live or periodically refreshed data.
 */
export const LIVE_DATA_ENABLED = truthy(process.env.LIVE_DATA_ENABLED);

export function isLiveDataEnabled() {
  return LIVE_DATA_ENABLED;
}

export function requireLiveData() {
  if (!LIVE_DATA_ENABLED) {
    const error = new Error('Live data source features are not enabled');
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Real-time collaboration (presence) configuration.
 * When enabled, the server mounts a Yjs/Hocuspocus WebSocket endpoint at
 * /collab and the editor shows live collaborator presence. Default: off —
 * single-user installs run without any collaboration transport.
 * Read at call time (not module load) so .env loading order can't bite.
 */
export function isCollabEnabled() {
  return truthy(process.env.COLLAB_ENABLED);
}

/**
 * Real-time collaboration (live document edits) configuration.
 * Phase 2 on top of presence: the Y.Doc becomes the live source of truth
 * while a deck is open collaboratively — persisted server-side and
 * serialized back to the deck JSON. Requires COLLAB_ENABLED; kept as a
 * separate flag so presence can ship and soak alone. Default: off.
 */
export function isCollabLiveEditsEnabled() {
  return isCollabEnabled() && truthy(process.env.COLLAB_LIVE_EDITS);
}

/**
 * RSS Feed configuration.
 * When enabled, organizations can activate RSS/Atom/JSON feeds for published presentations.
 * Default: true (enabled). The env var is a kill switch for instances that don't want the feature.
 * The org-level toggle (settings.rss.enabled) is the real user-facing gate.
 */
export const RSS_FEED_ENABLED =
  process.env.RSS_FEED_ENABLED === undefined
    ? true
    : truthy(process.env.RSS_FEED_ENABLED);

export function isRssFeedEnabled() {
  return RSS_FEED_ENABLED;
}
