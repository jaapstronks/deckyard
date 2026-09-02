/**
 * Notion suggest endpoint handler.
 * Backwards-compatible endpoint that returns the first subject's composed raw.
 * Feature-gated endpoint.
 */

import { badRequest, serveJson } from '../../../utils/http.js';
import { refuseNotionUnconfigured } from './utils.js';
import {
  getPlainTextFromPage,
  notionEnabled,
  searchRecentPages,
} from '../../../utils/notion/index.js';

/**
 * Handle POST /api/notion/suggest
 * Backwards-compatible: old endpoint returns the first subject's composed raw.
 * Feature-gated endpoint.
 */
export async function handleNotionSuggest({ res }) {
  if (!notionEnabled()) return refuseNotionUnconfigured(res);

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
