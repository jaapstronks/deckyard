/**
 * Feature configuration for multi-workspace support.
 * These features are gated by environment variables.
 */

import { truthy } from './utils.js';
import { getStorageMode } from './database.js';
import { sandboxEnabled } from './sandbox.js';

/**
 * Multi-workspace mode configuration.
 * When enabled, organizations become workspaces that users can create and switch between.
 * When disabled (default), the system operates in single-workspace mode using the default organization.
 */
export const MULTI_WORKSPACE_ENABLED = truthy(process.env.MULTI_WORKSPACE_ENABLED);

/**
 * Check if multi-workspace features are enabled.
 * @returns {boolean}
 */
export function isMultiWorkspaceEnabled() {
  return MULTI_WORKSPACE_ENABLED;
}

/**
 * Guard function that throws if multi-workspace is not enabled.
 * Use this to protect routes that should only be available in multi-workspace mode.
 */
export function requireMultiWorkspace() {
  if (!MULTI_WORKSPACE_ENABLED) {
    const error = new Error('Multi-workspace features are not enabled');
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Boot-time fail-closed guard against a leaking shared instance.
 *
 * Multi-workspace mode serves more than one organization from a single
 * instance, so deck isolation must be enforced by the storage layer. The
 * Postgres backend scopes every presentation query by organization_id
 * (server/storage/adapters/postgres/presentations.js), so cross-org reads
 * return nothing. The file backend has no org dimension at all — decks live
 * flat in one directory and listPresentations() never consults the org — so
 * two tenants on one file backend would see each other's workspace decks.
 *
 * This returns a human-readable error string when MULTI_WORKSPACE_ENABLED is
 * on but the storage backend cannot enforce org isolation, else null. It reads
 * process.env at call time (not the module-load MULTI_WORKSPACE_ENABLED
 * constant) so boot order and tests both see the live config.
 *
 * Sandbox mode is deliberately exempt: it is a single-org, anonymous,
 * throwaway instance (see docs/reference/tenant-isolation.md), so there is no
 * second tenant to leak to even if the flag is combined with sandbox.
 *
 * @returns {string|null}
 */
export function multiWorkspaceStorageError() {
  if (!truthy(process.env.MULTI_WORKSPACE_ENABLED)) return null;
  if (sandboxEnabled()) return null;
  if (getStorageMode() === 'postgres') return null;
  return (
    'MULTI_WORKSPACE_ENABLED=true requires the Postgres storage backend ' +
    '(STORAGE_MODE=postgres). The file backend has no per-organization ' +
    'isolation, so multiple tenants sharing it would see each other\'s ' +
    'workspace decks. Either set STORAGE_MODE=postgres, or run one dedicated ' +
    'instance per customer with MULTI_WORKSPACE_ENABLED unset ' +
    '(see docs/reference/tenant-isolation.md).'
  );
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
