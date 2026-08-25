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
} from '../../storage/tags.js';
import {
  serveJson,
  badRequest,
  notFound,
  requireJsonBody,
  methodNotAllowed,
  withErrorHandler,
} from '../../utils/http.js';
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
  const { limit } = parsePaginationParams(url.searchParams, {
    defaultLimit: 10,
    maxLimit: 50,
  });
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
  // Duplicate/invalid tag names come back as a 400 from storage; the
  // withErrorHandler wrapper on this dispatcher serves that status with the
  // canonical envelope.
  const tag = await createTag(storageScope, body.name);
  serveJson(res, 201, tag);
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
  {
    method: 'DELETE',
    pattern: /^\/api\/tags\/([a-f0-9-]+)$/,
    handler: handleTagDelete,
  },
];

/**
 * Handle tags API requests.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleTags = withErrorHandler('tags', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});

/**
 * Handle presentation tags API requests
 * These are called from the presentations handler.
 */
export async function handlePresentationTags({
  storageScope,
  req,
  res,
  presentationId,
}) {
  // The path is already matched by the presentations ROUTES table
  // (`/^\/api\/presentations\/([^/]+)\/tags$/`), which passes the captured id as
  // `presentationId` — so the pathname always equals
  // `/api/presentations/${presentationId}/tags`. The old exact-path recheck here
  // was therefore dead; dropped in C8 cleanup (A7.19).

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
    const tags = await setTagsForPresentation(
      storageScope,
      presentationId,
      body.tags,
    );
    serveJson(res, 200, tags);
    return true;
  }

  return methodNotAllowed(res);
}
