/**
 * Notion status endpoint handler.
 * Provides capability detection for the UI.
 */

import { serveJson } from '../../../utils/http.js';
import { getFeatureFlags } from '../../../config/feature-flags.js';
import { notionEnabled } from '../../../utils/notion.js';

/**
 * Handle GET /api/notion/status
 * Returns the current Notion integration status.
 */
export async function handleNotionStatus({ req, res, url }) {
  if (url.pathname !== '/api/notion/status' || req.method !== 'GET') {
    return false;
  }

  const flags = getFeatureFlags();
  const featureOn = !!flags?.enableNotion;

  serveJson(res, 200, {
    enabled: notionEnabled(),
    fullFeatures: featureOn && notionEnabled(),
  });
  return true;
}