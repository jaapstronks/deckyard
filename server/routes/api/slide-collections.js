/**
 * Slide collections API.
 *
 * A collection is a named, ordered, scoped set of slide-library item ids.
 * Personal collections are private to their owner; organization collections are
 * organization-wide and mutable by their creator or an admin (mirroring the
 * slide library's authz model).
 */

import {
  methodNotAllowed,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
  unauthorized,
  withErrorHandler,
} from '../../utils/http.js';
import {
  getPersonalCollection,
  createPersonalCollection,
  updatePersonalCollection,
  deletePersonalCollection,
  getOrganizationCollection,
  createOrganizationCollection,
  updateOrganizationCollection,
  deleteOrganizationCollection,
} from '../../storage/collections.js';
import { matchesIdentity } from '../../../shared/identity-match.js';
import { dispatchRoutes } from '../../utils/router.js';
import { sharingEnabled } from '../../config/sandbox.js';
import { assertSharingEnabled } from '../../sandbox/sharing.js';
import { normalizeEmail } from '../../../shared/email.js';
import { getLibraryItemsByIds } from '../../storage/slide-library.js';
import {
  libraryListInput,
  listCollectionPage,
} from '../../services/library-lists.js';

/**
 * Organization-shelf collections may only be mutated by an admin or the creator.
 *
 * Identity is matched through shared/identity-match.js, on the stable
 * `users.id` and nothing else, so the creator keeps their mutate right across a
 * rename (T10 PR F2) and a collection with no creator id is admin-only.
 * @param {object} authedUser
 * @returns {(collection: object) => boolean}
 */
function organizationMutateGuard(authedUser) {
  return (collection) => {
    // The organization shelf is read-only where sharing is off (D181), for everyone.
    if (!sharingEnabled()) return false;
    if (authedUser?.isAdmin) return true;
    return matchesIdentity(authedUser, {
      userId: collection?.createdBy?.id,
    });
  };
}

/**
 * Answer a failed collection mutation in the canonical envelope. The reason is
 * the machine code and its `REASONS` entry is the status, so the three-way
 * not_found/forbidden/else ladder this replaced is gone: `not_found` is a 404
 * and `forbidden` a 403 because the register says so, not because this route
 * happened to spell them out.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{reason: string, field?: string}} result
 * @returns {true}
 */
function mutationError(res, result) {
  return storageError(res, result);
}

function actorEmail(authedUser) {
  return normalizeEmail(authedUser?.email);
}

// GET /api/slide-collections/{personal|organization} - One page of a shelf's
// collections on the list-page contract (D358, B822): `{ items, nextCursor }`,
// each stamped with the verdict of the one mutate guard (D170), so the client
// derives nothing. The personal shelf holds only the caller's own.
function shelfList(shelf) {
  return async function handleShelfList({
    storageScope,
    res,
    url,
    authedUser,
  }) {
    const { items, nextCursor } = await listCollectionPage(
      storageScope,
      { shelf, readerEmail: actorEmail(authedUser) },
      libraryListInput(url.searchParams),
    );
    const mayMutate =
      shelf === 'personal' ? () => true : organizationMutateGuard(authedUser);
    serveJson(res, 200, {
      items: items.map((item) => ({ ...item, canEdit: mayMutate(item) })),
      nextCursor,
    });
    return true;
  };
}

// GET /api/slide-collections/{personal|organization}/:id/slides - The library
// items of one collection, in its order: what the reader may see of them
// (organization-shelf items and their own personal ones), trashed ones with
// their `trashedAt`. Bounded by the collection, so not a list page.
function shelfMembers(shelf) {
  return async function handleShelfMembers(
    { storageScope, res, authedUser },
    id,
  ) {
    const email = actorEmail(authedUser);
    const collection =
      shelf === 'personal'
        ? await getPersonalCollection(storageScope, email, id)
        : await getOrganizationCollection(storageScope, id, {
            userEmail: email,
          });
    if (!collection) return notFound(res);
    serveJson(res, 200, {
      items: await getLibraryItemsByIds(storageScope, collection.slideIds, {
        userEmail: email,
      }),
    });
    return true;
  };
}

// POST /api/slide-collections/personal
async function handlePersonalCreate({ storageScope, req, res, authedUser }) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await createPersonalCollection(storageScope, email, body, {
    actorEmail: email,
  });
  if (!r.ok) return mutationError(res, r);
  serveJson(res, 201, r.item);
  return true;
}

// GET /api/slide-collections/personal/:id
async function handlePersonalGet({ storageScope, res, authedUser }, id) {
  const item = await getPersonalCollection(
    storageScope,
    actorEmail(authedUser),
    id,
  );
  if (!item) return notFound(res);
  serveJson(res, 200, item);
  return true;
}

// PATCH /api/slide-collections/personal/:id
async function handlePersonalUpdate(
  { storageScope, req, res, authedUser },
  id,
) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await updatePersonalCollection(storageScope, email, id, body, {
    actorEmail: email,
  });
  if (!r.ok) return mutationError(res, r);
  serveJson(res, 200, r.item);
  return true;
}

// DELETE /api/slide-collections/personal/:id
async function handlePersonalDelete({ storageScope, res, authedUser }, id) {
  const r = await deletePersonalCollection(
    storageScope,
    actorEmail(authedUser),
    id,
  );
  if (!r.ok) return notFound(res);
  serveJson(res, 200, { ok: true });
  return true;
}

// POST /api/slide-collections/organization
async function handleOrganizationCreate({
  storageScope,
  req,
  res,
  authedUser,
}) {
  assertSharingEnabled();
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await createOrganizationCollection(storageScope, body, {
    actorEmail: email,
  });
  if (!r.ok) return mutationError(res, r);
  serveJson(res, 201, r.item);
  return true;
}

// GET /api/slide-collections/organization/:id
async function handleOrganizationGet({ storageScope, res, authedUser }, id) {
  const item = await getOrganizationCollection(storageScope, id, {
    userEmail: actorEmail(authedUser),
  });
  if (!item) return notFound(res);
  serveJson(res, 200, item);
  return true;
}

// PATCH /api/slide-collections/organization/:id
async function handleOrganizationUpdate(
  { storageScope, req, res, authedUser },
  id,
) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await updateOrganizationCollection(storageScope, id, body, {
    actorEmail: actorEmail(authedUser),
    allowMutate: organizationMutateGuard(authedUser),
  });
  if (!r.ok) return mutationError(res, r);
  serveJson(res, 200, r.item);
  return true;
}

// DELETE /api/slide-collections/organization/:id
async function handleOrganizationDelete({ storageScope, res, authedUser }, id) {
  const r = await deleteOrganizationCollection(storageScope, id, {
    actorEmail: actorEmail(authedUser),
    allowMutate: organizationMutateGuard(authedUser),
  });
  if (!r.ok) return mutationError(res, r);
  serveJson(res, 200, { ok: true });
  return true;
}

/**
 * Declarative route table for `/api/slide-collections*` (A7.19 C8). Order
 * matches the previous if-chain; each path group sent an explicit 405 for a
 * wrong method, preserved as trailing catch-all rows.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/slide-collections/personal',
    handler: shelfList('personal'),
  },
  {
    method: 'POST',
    pattern: '/api/slide-collections/personal',
    handler: handlePersonalCreate,
  },
  {
    pattern: '/api/slide-collections/personal',
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/slide-collections\/personal\/([^/]+)$/,
    captures: ['uuid'],
    handler: handlePersonalGet,
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/slide-collections\/personal\/([^/]+)$/,
    captures: ['uuid'],
    handler: handlePersonalUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/slide-collections\/personal\/([^/]+)$/,
    captures: ['uuid'],
    handler: handlePersonalDelete,
  },
  {
    pattern: /^\/api\/slide-collections\/personal\/([^/]+)$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/slide-collections\/personal\/([^/]+)\/slides$/,
    captures: ['uuid'],
    handler: shelfMembers('personal'),
  },
  {
    pattern: /^\/api\/slide-collections\/personal\/([^/]+)\/slides$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
  {
    method: 'GET',
    pattern: '/api/slide-collections/organization',
    handler: shelfList('organization'),
  },
  {
    method: 'POST',
    pattern: '/api/slide-collections/organization',
    handler: handleOrganizationCreate,
  },
  {
    pattern: '/api/slide-collections/organization',
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/slide-collections\/organization\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleOrganizationGet,
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/slide-collections\/organization\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleOrganizationUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/slide-collections\/organization\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleOrganizationDelete,
  },
  {
    pattern: /^\/api\/slide-collections\/organization\/([^/]+)$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/slide-collections\/organization\/([^/]+)\/slides$/,
    captures: ['uuid'],
    handler: shelfMembers('organization'),
  },
  {
    pattern: /^\/api\/slide-collections\/organization\/([^/]+)\/slides$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
];

/**
 * Handle slide-collection API routes. The module-wide guards (path prefix,
 * authentication) run before dispatch, exactly as the original chain did.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleSlideCollections = withErrorHandler(
  'slide-collections',
  (ctx) => {
    if (!ctx.url.pathname.startsWith('/api/slide-collections')) return false;
    if (!ctx.authedUser) return unauthorized(ctx.res);
    return dispatchRoutes(ROUTES, ctx);
  },
);
