/**
 * Feature configuration for multi-workspace support.
 * These features are gated by environment variables.
 */

import { truthy } from './utils.js';

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
