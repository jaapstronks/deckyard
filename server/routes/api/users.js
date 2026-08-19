/**
 * API routes for user search and profile lookup.
 *
 * Authenticated endpoints:
 *   GET /api/users/search?q=<query>&limit=10&exclude=email1,email2
 *   GET /api/users/profiles?ids=<uuid>,<uuid> - Batch profile lookup
 */

import { searchUsers, getPublicProfilesByIds } from '../../storage/users.js';
import { isUuid } from '../../utils/uuid.js';
import {
  serveJson,
  methodNotAllowed,
  unauthorized,
  withErrorHandler,
} from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';
import { dispatchRoutes } from '../../utils/router.js';

// GET /api/users/search - Search users in organization
async function handleUserSearch({ storageScope, res, url }) {
  const query = url.searchParams.get('q') || '';
  const { limit } = parsePaginationParams(url.searchParams, {
    defaultLimit: 10,
  });
  const excludeParam = url.searchParams.get('exclude') || '';
  const exclude = excludeParam
    ? excludeParam
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
    : [];

  if (!query.trim()) {
    return serveJson(res, 200, { users: [] });
  }

  const users = await searchUsers(storageScope, query, { limit, exclude });

  serveJson(res, 200, { users });
  return true;
}

// GET /api/users/profiles - Batch avatar lookup, keyed on stable user ids.
//
// Keyed on `users.id` rather than on an address since D22: the responses that
// name a person now carry `{ id, displayName }`, so the client has an id and no
// longer has an address to ask with — which also removes this endpoint's old
// side effect of confirming whether a given address exists.
//
// The auth check runs before the method check, so this stays a single
// no-method handler (see docs/reference/route-dispatch.md, Form B guard note):
// an unauthenticated request must get a 401, not a 405.
async function handleUserProfiles({ storageScope, req, res, url, authedUser }) {
  // Requires authentication to prevent user enumeration
  if (!authedUser?.email) {
    return unauthorized(res, 'Authentication required');
  }

  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  // Shape-checked before storage sees them: `users.id` is a uuid column, and
  // a value that cannot be a uuid cannot name a user (server/utils/uuid.js).
  const idsParam = url.searchParams.get('ids') || '';
  const ids = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter(isUuid)
    .slice(0, 50); // Limit to 50 ids per request

  if (!ids.length) {
    return serveJson(res, 200, { profiles: {} });
  }

  const profiles = await getPublicProfilesByIds(storageScope, ids);
  serveJson(res, 200, { profiles });
  return true;
}

/**
 * Declarative route table for `/api/users/*` (A7.19 C8). Order matches the
 * previous if-chain. `/search` is GET-only and falls through on a method
 * mismatch (the chain had no 405 there); `/profiles` keeps its guard-then-method
 * shape as a single no-method handler.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/users/search', handler: handleUserSearch },
  { pattern: '/api/users/profiles', handler: handleUserProfiles },
];

/**
 * Handle user-related API endpoints.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleUsers = withErrorHandler('users', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);
