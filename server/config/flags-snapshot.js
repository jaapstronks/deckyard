/**
 * The feature-flag snapshot handed to the client (as `features` in the
 * `/api/auth/me` payload) and read directly by server-side routes.
 * Pure aggregator: every env-var read lives in `config/features.js` (the
 * declaration module); this file only combines declared flags with runtime
 * status (LLM config, ImageKit config, branding) into one object.
 */

import { getLlmStatus } from '../utils/llm/config.js';
import { getImageKitConfigFromEnv } from '../media/imagekit.js';
import { sandboxEnabled } from './sandbox.js';
import {
  isMultiOrgEnabled,
  isLiveDataEnabled,
  isRssFeedEnabled,
  isCollabEnabled,
  isCollabLiveEditsEnabled,
  isDemoMode,
  isImagekitOnly,
  isAiEnabled,
  isUploadsEnabled,
  isImageLibraryEnabled,
  isNotionFeatureEnabled,
} from './features.js';
import { getBranding } from './branding.js';

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
  const enableNotion = !demoMode && isNotionFeatureEnabled();
  const llm = getLlmStatus();

  const aiAltText =
    enableAi &&
    llm?.defaultVendor === 'openai' &&
    Array.isArray(llm?.configuredVendors) &&
    llm.configuredVendors.includes('openai');

  return {
    demoMode,
    sandboxMode,
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
    collab: isCollabEnabled(),
    collabLiveEdits: isCollabLiveEditsEnabled(),
    branding: getBranding(),
  };
}
