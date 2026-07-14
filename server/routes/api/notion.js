/**
 * Notion API route handlers.
 *
 * This file orchestrates all Notion-related API endpoints by delegating
 * to modular handlers in the ./notion/ directory:
 * - notion/status.js - Status/capability detection
 * - notion/fetch.js - Fetch and publish endpoints
 * - notion/import.js - Import and stream-import endpoints
 * - notion/subjects.js - Subjects and compose endpoints (feature-gated)
 * - notion/suggest.js - Suggest endpoint (feature-gated)
 * - notion/utils.js - Shared utility functions
 */

import { getFeatureFlags } from '../../config/feature-flags.js';
import {
  handleNotionStatus,
  handleNotionFetch,
  handleNotionPublish,
  handleNotionImport,
  handleNotionImportStream,
  handleNotionSubjects,
  handleNotionCompose,
  handleNotionSuggest,
} from './notion/index.js';

export async function handleNotion({ req, res, url, authedUser, repoRoot } = {}) {
  // Status endpoint (always available)
  const statusHandled = await handleNotionStatus({ req, res, url });
  if (statusHandled) return true;

  // Fetch endpoint (available if Notion is configured)
  const fetchHandled = await handleNotionFetch({ req, res, url });
  if (fetchHandled) return true;

  // Publish endpoint (available if Notion is configured)
  const publishHandled = await handleNotionPublish({ req, res, url });
  if (publishHandled) return true;

  // Import endpoint (available if Notion is configured)
  const importHandled = await handleNotionImport({ req, res, url, authedUser, repoRoot });
  if (importHandled) return true;

  // Stream import endpoint (available if Notion is configured)
  const streamHandled = await handleNotionImportStream({ req, res, url, authedUser, repoRoot });
  if (streamHandled) return true;

  // Feature gated endpoints: keep code shipped, but disabled unless explicitly enabled.
  const flags = getFeatureFlags();
  const featureOn = !!flags?.enableNotion;
  if (!featureOn) return false;

  // Subjects endpoint (feature-gated)
  const subjectsHandled = await handleNotionSubjects({ req, res, url });
  if (subjectsHandled) return true;

  // Compose endpoint (feature-gated)
  const composeHandled = await handleNotionCompose({ req, res, url });
  if (composeHandled) return true;

  // Suggest endpoint (feature-gated)
  const suggestHandled = await handleNotionSuggest({ req, res, url });
  if (suggestHandled) return true;

  return false;
}