import { getLlmStatus } from '../utils/llm/config.js';
import { sandboxEnabled } from './sandbox.js';
import {
  isMultiWorkspaceEnabled,
  isLiveDataEnabled,
  isRssFeedEnabled,
  isCollabEnabled,
  isCollabLiveEditsEnabled,
} from './features.js';
import { getBranding } from './branding.js';
import { truthy } from './utils.js';

export function getFeatureFlags() {
  const demoMode = truthy(process.env.DEMO_MODE);
  const sandboxMode = sandboxEnabled();
  const imagekitOnly = truthy(process.env.IMAGEKIT_ONLY);
  // AI is off in sandbox: a public, anonymous playground plus per-prompt LLM
  // cost is an open-ended bill the moment the URL is found, and AI generation
  // isn't the reason to reach for Deckyard anyway. Matches demo mode.
  const disableAi = demoMode || sandboxMode || truthy(process.env.DISABLE_AI);
  const disableUploads =
    demoMode || sandboxMode || truthy(process.env.DISABLE_UPLOADS) || imagekitOnly;
  const disableImageLibrary =
    imagekitOnly || truthy(process.env.DISABLE_IMAGE_LIBRARY);
  const enableNotion = !demoMode && truthy(process.env.NOTION_FEATURE);
  const llm = getLlmStatus();

  const aiAltText =
    !disableAi &&
    llm?.defaultVendor === 'openai' &&
    Array.isArray(llm?.configuredVendors) &&
    llm.configuredVendors.includes('openai');

  return {
    demoMode,
    sandboxMode,
    imagekitOnly,
    disableAi,
    disableUploads,
    disableImageLibrary,
    enableNotion,
    llm,
    aiAltText,
    multiWorkspace: isMultiWorkspaceEnabled(),
    enableLiveData: isLiveDataEnabled(),
    enableRssFeed: isRssFeedEnabled(),
    collab: isCollabEnabled(),
    collabLiveEdits: isCollabLiveEditsEnabled(),
    branding: getBranding(),
  };
}
