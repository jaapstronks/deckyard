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
import { serveJson, badRequest, notFound, parseJsonBody, methodNotAllowed } from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';

/**
 * Handle tags API requests
 */
export async function handleTags({ req, res, url }) {
  const pathname = url.pathname;

  // GET /api/tags - List all tags
  if (pathname === '/api/tags' && req.method === 'GET') {
    const tags = await listTags();
    serveJson(res, 200, tags);
    return true;
  }

  // GET /api/tags/search?q=prefix - Search tags by prefix (for autocomplete)
  if (pathname === '/api/tags/search' && req.method === 'GET') {
    const query = url.searchParams.get('q') || '';
    const { limit } = parsePaginationParams(url.searchParams, { defaultLimit: 10, maxLimit: 50 });
    const tags = await searchTags(query, limit);
    serveJson(res, 200, tags);
    return true;
  }

  // POST /api/tags - Create a new tag
  if (pathname === '/api/tags' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    if (!body?.name) {
      return badRequest(res, 'Tag name is required');
    }
    try {
      const tag = await createTag(body.name);
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
  const deleteMatch = pathname.match(/^\/api\/tags\/([a-f0-9-]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const tagId = deleteMatch[1];
    const deleted = await deleteTag(tagId);
    if (!deleted) {
      return notFound(res, 'Tag not found');
    }
    serveJson(res, 200, { success: true });
    return true;
  }

  return false;
}

/**
 * Handle presentation tags API requests
 * These are called from the presentations handler.
 */
export async function handlePresentationTags({ req, res, url, presentationId }) {
  const pathname = url.pathname;
  const tagsPath = `/api/presentations/${presentationId}/tags`;

  if (pathname !== tagsPath) {
    return false;
  }

  // GET /api/presentations/:id/tags - Get tags for a presentation
  if (req.method === 'GET') {
    const tags = await getTagsForPresentation(presentationId);
    serveJson(res, 200, tags);
    return true;
  }

  // PUT /api/presentations/:id/tags - Set tags for a presentation
  if (req.method === 'PUT') {
    const body = await parseJsonBody(req);
    if (!Array.isArray(body?.tags)) {
      return badRequest(res, 'Tags array is required');
    }
    const tags = await setTagsForPresentation(presentationId, body.tags);
    serveJson(res, 200, tags);
    return true;
  }

  return methodNotAllowed(res);
}