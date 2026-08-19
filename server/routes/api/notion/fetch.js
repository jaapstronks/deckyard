/**
 * Notion fetch and publish endpoint handlers.
 * Handles fetching Notion pages and publishing embeds back to Notion.
 */

import {
  badRequest,
  serveJson,
  jsonError,
  requireJsonBody,
} from '../../../utils/http.js';
import { getTrimmedString } from '../../../utils/request-validators.js';
import {
  extractPageId,
  fetchNotionPage,
  notionEnabled,
  publishEmbedToNotionPage,
} from '../../../utils/notion/index.js';
import { handleNotionError } from './utils.js';

/**
 * Handle POST /api/notion/fetch
 * Fetch a single Notion page by URL or ID.
 * Available even if the feature flag is off, as long as Notion is configured.
 */
export async function handleNotionFetch({ req, res }) {
  if (!notionEnabled()) {
    jsonError(res, 501, 'notion_not_configured', 'Notion not configured', {
      details: 'Set NOTION_SECRET on the server to enable this feature.',
    });
    return true;
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
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
export async function handleNotionPublish({ req, res }) {
  if (!notionEnabled()) {
    jsonError(res, 501, 'notion_not_configured', 'Notion not configured', {
      details: 'Set NOTION_SECRET on the server to enable this feature.',
    });
    return true;
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const pageId = getTrimmedString(body, 'pageId') || '';
  const embedUrl = getTrimmedString(body, 'embedUrl') || '';
  const title = getTrimmedString(body, 'title') || '';
  const lang = body?.lang === 'en-GB' ? 'en-GB' : 'nl';

  if (!pageId) {
    return badRequest(
      res,
      'Expected { pageId } - the Notion page ID to publish to',
    );
  }
  if (!embedUrl) {
    return badRequest(
      res,
      'Expected { embedUrl } - the presentation embed URL',
    );
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
      message:
        lang === 'nl'
          ? 'Presentatie toegevoegd aan Notion-pagina'
          : 'Presentation added to Notion page',
      blocksAdded: result.blocksAdded,
    });
  } catch (e) {
    handleNotionError(e, res);
  }
  return true;
}
