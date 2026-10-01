/**
 * Notion status endpoint handler.
 * Provides capability detection for the UI.
 */

import { serveJson } from '../../../utils/http.js';
import { notionEnabled } from '../../../utils/notion/index.js';

/**
 * Handle GET /api/notion/status
 * Reports whether Notion is configured (`NOTION_SECRET`). The route only
 * exists with `NOTION_ENABLED` on, so being reached already says the
 * integration is part of this installation.
 */
export async function handleNotionStatus({ res }) {
  serveJson(res, 200, { enabled: notionEnabled() });
  return true;
}
