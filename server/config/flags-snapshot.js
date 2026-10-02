/**
 * The feature-flag snapshot handed to the client (as `features` in the
 * `/api/auth/me` payload) and read directly by server-side routes.
 * Pure aggregator: every env-var read lives in a declaration module
 * (`config/features.js` for flags, `config/retention.js` for retention
 * windows); this file only combines declared values with runtime status (LLM
 * config, ImageKit config, branding) into one object.
 */

import { getLlmStatus } from '../utils/llm/config.js';
import { getImageKitConfigFromEnv } from '../media/imagekit.js';
import { sandboxEnabled, sandboxTtlHours, sharingEnabled } from './sandbox.js';
import {
  isMultiOrgEnabled,
  isLiveDataEnabled,
  isRssFeedEnabled,
  isAnalyticsEnabled,
  isLiveEnabled,
  isStockMediaEnabled,
  isPublicApiEnabled,
  isCollabEnabled,
  isCollabLiveEditsEnabled,
  isDemoMode,
  isImagekitOnly,
  isAiEnabled,
  isUploadsEnabled,
  isImageLibraryEnabled,
  isNotionEnabled,
} from './features.js';
import { getBranding } from './branding.js';
import { trashRetentionDays } from './retention.js';

export function getFeatureFlags() {
  const demoMode = isDemoMode();
  const sandboxMode = sandboxEnabled();
  const imagekitOnly = isImagekitOnly();
  // AI is off in sandbox: a public, anonymous playground plus per-prompt LLM
  // cost is an open-ended bill the moment the URL is found, and AI generation
  // isn't the reason to reach for Deckyard anyway. Matches demo mode.
  const enableAi = !demoMode && !sandboxMode && isAiEnabled();
  const enableUploads =
    !demoMode && !sandboxMode && !imagekitOnly && isUploadsEnabled();
  const enableImageLibrary = !imagekitOnly && isImageLibraryEnabled();
  // Whether the ImageKit DAM is actually usable (all IMAGEKIT_* keys present).
  // The image-source chooser gates its ImageKit option on this so an
  // unconfigured install never shows a button that only leads to an error.
  const imagekitConfigured = getImageKitConfigFromEnv().configured;
  const enableNotion = !demoMode && isNotionEnabled();
  const llm = getLlmStatus();

  const aiAltText =
    enableAi &&
    llm?.defaultVendor === 'openai' &&
    Array.isArray(llm?.configuredVendors) &&
    llm.configuredVendors.includes('openai');

  return {
    demoMode,
    sandboxMode,
    // The banner states this number; null outside sandbox, where nothing expires.
    sandboxTtlHours: sandboxMode ? sandboxTtlHours() : null,
    // Sharing between people (D181): off in sandbox. The client greys out every
    // sharing entry with one sentence of why, rather than hiding it.
    enableSharing: sharingEnabled(),
    imagekitOnly,
    imagekitConfigured,
    enableAi,
    enableUploads,
    enableImageLibrary,
    enableNotion,
    llm,
    aiAltText,
    multiOrganization: isMultiOrgEnabled(),
    enableLiveData: isLiveDataEnabled(),
    enableRssFeed: isRssFeedEnabled(),
    enableAnalytics: isAnalyticsEnabled(),
    enableLive: isLiveEnabled(),
    enableStockMedia: isStockMediaEnabled(),
    enablePublicApi: isPublicApiEnabled(),
    collab: isCollabEnabled(),
    collabLiveEdits: isCollabLiveEditsEnabled(),
    // The trash hint states this number, so the copy and the sweep that acts on
    // it read the same configuration and cannot promise different things.
    trashRetentionDays: trashRetentionDays(),
    branding: getBranding(),
  };
}

/**
 * Is this installation's cluster `key` on (D257)?
 *
 * The one question every `feature` declaration asks — a mount, a route row, an
 * MCP tool. The key is the env prefix in lowerCamel and lands on the snapshot
 * key `enable<Key>`: `AI_ENABLED` ↔ `enableAi` ↔ `'ai'`, `RSS_FEED_ENABLED` ↔
 * `enableRssFeed` ↔ `'rssFeed'`. Derived, not looked up, so there is no second
 * vocabulary to keep in step; a key that lands on no snapshot key throws, so a
 * typo in a declaration fails loudly instead of switching something off.
 *
 * @param {string} key - The cluster key (`'ai'`, `'notion'`, …)
 * @returns {boolean}
 */
export function isFeatureEnabled(key) {
  const flag = featureFlagKey(key);
  const flags = getFeatureFlags();
  if (!(flag in flags)) {
    throw new TypeError(
      `unknown feature '${key}': no '${flag}' in the snapshot`,
    );
  }
  return flags[flag] === true;
}

/**
 * The snapshot key a cluster key lands on: `'imageLibrary'` → `'enableImageLibrary'`.
 * @param {string} key
 * @returns {string}
 */
export function featureFlagKey(key) {
  return `enable${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}
