/**
 * Notion suggest endpoint handler.
 * Backwards-compatible endpoint that returns the first subject's composed raw.
 * Feature-gated endpoint.
 */

import { badRequest, serveJson } from '../../../utils/http.js';
import {
  getPlainTextFromPage,
  notionEnabled,
  searchRecentPages,
} from '../../../utils/notion.js';

/**
 * Handle POST /api/notion/suggest
 * Backwards-compatible: old endpoint returns the first subject's composed raw.
 * Feature-gated endpoint.
 */
export async function handleNotionSuggest({ req, res, url }) {
  if (url.pathname !== '/api/notion/suggest' || req.method !== 'POST') {
    return false;
  }

  if (!notionEnabled()) {
    serveJson(res, 501, {
      error: 'Notion not configured',
      details: 'Set NOTION_SECRET on the server to enable this feature.',
    });
    return true;
  }

  const all = await searchRecentPages({ pageSize: 50 });
  const filtered = all;
  const picked = filtered[0] || null;
  if (!picked) return badRequest(res, 'No recent Notion pages found.');
  const raw = (
    await getPlainTextFromPage(picked.id, { depth: 2, limit: 400 })
  ).trim();
  if (!raw) return badRequest(res, 'No readable Notion content found.');
  serveJson(res, 200, { raw });
  return true;
}