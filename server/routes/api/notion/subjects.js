/**
 * Notion subjects and compose endpoint handlers.
 * Handles subject picking and raw content composition for AI wizard.
 * These endpoints are feature-gated.
 */

import { badRequest, json, serveJson } from '../../../utils/http.js';
import {
  getPlainTextFromPage,
  getPlainTextPreviewFromPage,
  notionEnabled,
  searchPages,
  searchRecentPages,
} from '../../../utils/notion.js';
import { looksLikeUsableDoc, pickKeywordForPage } from './utils.js';

/**
 * Handle POST /api/notion/subjects
 * Subject picker for AI wizard: return 3 recent "subjects" for this creator.
 * Feature-gated endpoint.
 */
export async function handleNotionSubjects({ req, res, url }) {
  if (url.pathname !== '/api/notion/subjects' || req.method !== 'POST') {
    return false;
  }

  if (!notionEnabled()) {
    serveJson(res, 501, {
      error: 'Notion not configured',
      details: 'Set NOTION_SECRET on the server to enable this feature.',
    });
    return true;
  }

  const body = await json(req);
  const keyword =
    typeof body?.keyword === 'string' ? body.keyword.trim() : '';
  const hasKeyword = keyword.length >= 2;

  const all = hasKeyword
    ? await searchPages({ query: keyword, pageSize: 50 })
    : await searchRecentPages({ pageSize: 50 });
  const candidates = all; // already sorted; scan until we find 3 usable docs

  const subjects = [];
  let checked = 0;
  const MAX_LOOKUPS = 20; // safety: keep Notion calls bounded
  for (const p of candidates) {
    if (!p?.id) continue;
    if (checked >= MAX_LOOKUPS) break;
    checked++;
    let preview = '';
    try {
      preview = await getPlainTextPreviewFromPage(p.id, { limit: 120 });
    } catch {
      preview = '';
    }
    if (!looksLikeUsableDoc(preview)) continue;
    const kw = pickKeywordForPage(p);
    subjects.push({
      pageId: p.id,
      title: String(p.title || '').trim() || 'Untitled',
      keyword: kw || null,
    });
    if (subjects.length >= 3) break;
  }

  if (!subjects.length) {
    badRequest(
      res,
      'No recent Notion pages found.'
    );
    return true;
  }

  serveJson(res, 200, {
    subjects,
    meta: {
      checkedPages: checked,
      mode: hasKeyword ? 'search' : 'recent',
      keyword: hasKeyword ? keyword : null,
      total: all.length,
    },
  });
  return true;
}

/**
 * Handle POST /api/notion/compose
 * Compose raw input for the existing AI wizard (no attribution).
 * Feature-gated endpoint.
 */
export async function handleNotionCompose({ req, res, url }) {
  if (url.pathname !== '/api/notion/compose' || req.method !== 'POST') {
    return false;
  }

  if (!notionEnabled()) {
    serveJson(res, 501, {
      error: 'Notion not configured',
      details: 'Set NOTION_SECRET on the server to enable this feature.',
    });
    return true;
  }

  const body = await json(req);
  const pageId = typeof body?.pageId === 'string' ? body.pageId.trim() : '';
  const keywordRaw =
    typeof body?.keyword === 'string' ? body.keyword.trim() : '';
  const keyword = keywordRaw ? keywordRaw.toLowerCase() : '';
  const hasKeyword = keyword.length >= 2;

  // If we don't have a page id but we do have a keyword: compose from multiple pages matching that keyword.
  if (!pageId) {
    if (!hasKeyword) return badRequest(res, 'Expected { pageId } or { keyword }');

    const results = await searchPages({ query: keywordRaw, pageSize: 50 });
    const ids = [];
    let checked = 0;
    const MAX_LOOKUPS = 12;
    for (const p of results) {
      if (!p?.id) continue;
      if (checked >= MAX_LOOKUPS) break;
      checked++;
      let preview = '';
      try {
        preview = await getPlainTextPreviewFromPage(p.id, { limit: 120 });
      } catch {
        preview = '';
      }
      if (!looksLikeUsableDoc(preview)) continue;
      ids.push(p.id);
      if (ids.length >= 3) break;
    }
    if (!ids.length)
      return badRequest(res, 'No readable Notion content found for this keyword.');

    const chunks = [];
    for (const id of ids) {
      const text = await getPlainTextFromPage(id, { depth: 2, limit: 400 });
      if (text) chunks.push(text);
    }
    const raw = chunks.join('\n\n').trim();
    if (!raw) return badRequest(res, 'No readable Notion content found.');
    serveJson(res, 200, {
      raw,
      meta: { pagesUsed: ids.length, checkedPages: checked, mode: 'search' },
    });
    return true;
  }

  const base = hasKeyword
    ? await searchPages({ query: keywordRaw, pageSize: 50 })
    : await searchRecentPages({ pageSize: 50 });

  // Pick related pages based on keyword matching in the title (best-effort).
  const related =
    keyword.length >= 4
      ? base.filter((p) =>
          String(p?.title || '').toLowerCase().includes(keyword)
        )
      : [];

  // Always include chosen page first; then add up to 2 related distinct pages that look usable.
  const ids = [pageId];
  let relatedChecked = 0;
  const MAX_RELATED_LOOKUPS = 6;
  for (const p of related) {
    if (!p?.id) continue;
    if (p.id === pageId) continue;
    if (relatedChecked >= MAX_RELATED_LOOKUPS) break;
    relatedChecked++;
    let preview = '';
    try {
      preview = await getPlainTextPreviewFromPage(p.id, { limit: 120 });
    } catch {
      preview = '';
    }
    if (!looksLikeUsableDoc(preview)) continue;
    ids.push(p.id);
    if (ids.length >= 3) break;
  }

  const chunks = [];
  for (const id of ids) {
    const text = await getPlainTextFromPage(id, { depth: 2, limit: 400 });
    if (text) chunks.push(text);
  }
  const raw = chunks.join('\n\n').trim();
  if (!raw) return badRequest(res, 'No readable Notion content found.');

  serveJson(res, 200, {
    raw,
    meta: {
      pagesUsed: ids.length,
      mode: hasKeyword ? 'search+related' : 'recent+related',
      relatedCheckedPages: relatedChecked,
    },
  });
  return true;
}