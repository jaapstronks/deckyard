/**
 * Notion fetch and publish endpoint handlers.
 * Handles fetching Notion pages and publishing embeds back to Notion.
 */

import { badRequest, json, serveJson, jsonError } from '../../../utils/http.js';
import { getTrimmedString } from '../../../utils/request-validators.js';
import {
  extractPageId,
  fetchNotionPage,
  notionEnabled,
  publishEmbedToNotionPage,
} from '../../../utils/notion.js';
import { handleNotionError } from './utils.js';

/**
 * Handle POST /api/notion/fetch
 * Fetch a single Notion page by URL or ID.
 * Available even if the feature flag is off, as long as Notion is configured.
 */
export async function handleNotionFetch({ req, res, url }) {
  if (url.pathname !== '/api/notion/fetch' || req.method !== 'POST') {
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
  const urlOrId = getTrimmedString(body, 'url') || '';
  if (!urlOrId) {
    return badRequest(res, 'Expected { url } with a Notion page URL or ID');
  }

  const pageId = extractPageId(urlOrId);
  if (!pageId) {
    return badRequest(res, 'Invalid Notion URL or page ID format');
  }

  try {
    const result = await fetchNotionPage(urlOrId);
    serveJson(res, 200, {
      title: result.title,
      content: result.content,
      pageId: result.pageId,
    });
  } catch (e) {
    handleNotionError(e, res);
  }
  return true;
}

/**
 * Handle POST /api/notion/publish
 * Publish to Notion: append embed blocks to the source page.
 * Expects { pageId, embedUrl, title?, lang? }
 */
export async function handleNotionPublish({ req, res, url }) {
  if (url.pathname !== '/api/notion/publish' || req.method !== 'POST') {
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
  const pageId = getTrimmedString(body, 'pageId') || '';
  const embedUrl = getTrimmedString(body, 'embedUrl') || '';
  const title = getTrimmedString(body, 'title') || '';
  const lang = body?.lang === 'en-GB' ? 'en-GB' : 'nl';

  if (!pageId) {
    return badRequest(res, 'Expected { pageId } - the Notion page ID to publish to');
  }
  if (!embedUrl) {
    return badRequest(res, 'Expected { embedUrl } - the presentation embed URL');
  }

  const normalizedPageId = extractPageId(pageId);
  if (!normalizedPageId) {
    return badRequest(res, 'Invalid Notion page ID format');
  }

  try {
    const result = await publishEmbedToNotionPage(normalizedPageId, {
      embedUrl,
      title,
      lang,
    });
    serveJson(res, 200, {
      success: true,
      message: lang === 'nl'
        ? 'Presentatie toegevoegd aan Notion-pagina'
        : 'Presentation added to Notion page',
      blocksAdded: result.blocksAdded,
    });
  } catch (e) {
    const msg = String(e?.message || e || 'Unknown error');
    const code = e?.statusCode || 500;
    if (msg.includes('Could not find') || code === 404) {
      return badRequest(res, 'Notion page not found. Make sure the page is shared with your Notion integration.');
    }
    if (msg.includes('unauthorized') || code === 401 || code === 403) {
      return badRequest(res, 'Access denied. Make sure the page is shared with your Notion integration and has edit permissions.');
    }
    jsonError(res, code >= 400 && code < 600 ? code : 500, 'notion_error', msg);
  }
  return true;
}