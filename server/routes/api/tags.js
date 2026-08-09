/**
 * Tags API routes.
 *
 * GET /api/tags - List all tags
 * GET /api/tags/search?q=prefix - Search tags by prefix
 * POST /api/tags - Create a new tag
 * DELETE /api/tags/:tagId - Delete a tag
 * GET /api/presentations/:id/tags - Get tags for a presentation
 * PUT /api/presentations/:id/tags - Set tags for a presentation
 */

import {
  listTags,
  searchTags,
  createTag,
  deleteTag,
  getTagsForPresentation,
  setTagsForPresentation,
} from '../../storage/tags/index.js';
import { serveJson, badRequest, notFound, requireJsonBody, methodNotAllowed } from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';
import { dispatchRoutes } from '../../utils/router.js';

// GET /api/tags - List all tags
async function handleTagList({ storageScope, res }) {
  const tags = await listTags(storageScope);
  serveJson(res, 200, tags);
  return true;
}

// GET /api/tags/search?q=prefix - Search tags by prefix (for autocomplete)
async function handleTagSearch({ storageScope, res, url }) {
  const query = url.searchParams.get('q') || '';
  const { limit } = parsePaginationParams(url.searchParams, { defaultLimit: 10, maxLimit: 50 });
  const tags = await searchTags(storageScope, query, limit);
  serveJson(res, 200, tags);
  return true;
}

// POST /api/tags - Create a new tag
async function handleTagCreate({ storageScope, req, res }) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  if (!body?.name) {
    return badRequest(res, 'Tag name is required');
  }
  try {
    const tag = await createTag(storageScope, body.name);
    serveJson(res, 201, tag);
  } catch (err) {
    if (err.statusCode === 400) {
      return badRequest(res, err.message);
    }
    throw err;
  }
  return true;
}

// DELETE /api/tags/:tagId - Delete a tag
async function handleTagDelete({ storageScope, res }, tagId) {
  const deleted = await deleteTag(storageScope, tagId);
  if (!deleted) {
    return notFound(res, 'Tag not found');
  }
  serveJson(res, 200, { success: true });
  return true;
}

/**
 * Declarative route table for the top-level `/api/tags*` endpoints (A7.19 C8).
 * Order matches the previous if-chain; method mismatch falls through (the chain
 * had no 405). The per-presentation tag routes live in `handlePresentationTags`
 * below, mounted from the presentations dispatcher.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/tags', handler: handleTagList },
  { method: 'GET', pattern: '/api/tags/search', handler: handleTagSearch },
  { method: 'POST', pattern: '/api/tags', handler: handleTagCreate },
  { method: 'DELETE', pattern: /^\/api\/tags\/([a-f0-9-]+)$/, handler: handleTagDelete },
];

/**
 * Handle tags API requests.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleTags(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}

/**
 * Handle presentation tags API requests
 * These are called from the presentations handler.
 */
export async function handlePresentationTags({ storageScope, req, res, url, presentationId }) {
  const pathname = url.pathname;
  const tagsPath = `/api/presentations/${presentationId}/tags`;

  if (pathname !== tagsPath) {
    return false;
  }

  // GET /api/presentations/:id/tags - Get tags for a presentation
  if (req.method === 'GET') {
    const tags = await getTagsForPresentation(storageScope, presentationId);
    serveJson(res, 200, tags);
    return true;
  }

  // PUT /api/presentations/:id/tags - Set tags for a presentation
  if (req.method === 'PUT') {
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;
    if (!Array.isArray(body?.tags)) {
      return badRequest(res, 'Tags array is required');
    }
    const tags = await setTagsForPresentation(storageScope, presentationId, body.tags);
    serveJson(res, 200, tags);
    return true;
  }

  return methodNotAllowed(res);
}