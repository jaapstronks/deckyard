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
  storageError,
  withErrorHandler,
} from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';
import { withPresentationAuth } from '../../utils/route-middleware.js';
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
  // What a tag may be called is storage's contract, not this handler's: a
  // missing, blank, over-long or control-character name comes back as the one
  // `invalid` result, naming the field (B370).
  const r = await createTag(storageScope, body?.name);
  if (!r.ok) return storageError(res, r, r.message);
  serveJson(res, 201, r.tag);
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
    pattern: /^\/api\/tags\/([^/]+)$/,
    captures: ['uuid'],
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
 * `GET|PUT /api/presentations/:id/tags`, mounted from the presentations
 * dispatcher like every other `/api/presentations/:id/*` row.
 *
 * The deck is authorized before its tags are touched, through the same
 * {@link withPresentationAuth} as the rest of the deck routes (B436): reading
 * the tags takes read access, replacing them takes write access, and a deck
 * outside the caller's organization is absent, so a 404. The tags used to be
 * read and replaced on the id alone, which let a member of one organization
 * wipe the tags of another organization's deck and let any member retag a
 * private deck they may not open.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @param {string} presentationId
 * @returns {Promise<boolean>}
 */
export async function handlePresentationTags(
  { storageScope, req, res, authedUser },
  presentationId,
) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: req.method === 'GET' ? 'read' : 'write',
  });
  if (!pres) return true;

  if (req.method === 'GET') {
    const tags = await getTagsForPresentation(storageScope, pres.id);
    serveJson(res, 200, tags);
    return true;
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  if (!Array.isArray(body?.tags)) {
    return badRequest(res, 'Tags array is required');
  }
  const r = await setTagsForPresentation(storageScope, pres.id, body.tags);
  if (!r.ok) return storageError(res, r, r.message);
  serveJson(res, 200, r.tags);
  return true;
}
