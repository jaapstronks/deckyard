/**
 * Slide collections API.
 *
 * A collection is a named, ordered, scoped set of slide-library item ids.
 * Personal collections are private to their owner; organization collections are
 * organization-wide and mutable by their creator or an admin (mirroring the
 * slide library's authz model).
 */

import {
  badRequest,
  forbidden,
  methodNotAllowed,
  serveJson,
  unauthorized,
  notFound,
  requireJsonBody,
  withErrorHandler,
} from '../../utils/http.js';
import {
  listPersonalCollections,
  getPersonalCollection,
  createPersonalCollection,
  updatePersonalCollection,
  deletePersonalCollection,
  listOrganizationCollections,
  getOrganizationCollection,
  createOrganizationCollection,
  updateOrganizationCollection,
  deleteOrganizationCollection,
} from '../../storage/collections/index.js';
import { matchesIdentity } from '../../../shared/identity-match.js';
import { dispatchRoutes } from '../../utils/router.js';

/**
 * Organization-shelf collections may only be mutated by an admin or the creator.
 *
 * Identity is matched through shared/identity-match.js (id-first, e-mail
 * fallback) rather than raw lowercased e-mail, so the creator keeps their
 * mutate right across a rename (T10 PR F2).
 * @param {object} authedUser
 * @returns {(collection: object) => boolean}
 */
function organizationMutateGuard(authedUser) {
  return (collection) => {
    if (authedUser?.isAdmin) return true;
    return matchesIdentity(authedUser, {
      userId: collection?.createdById,
      email: collection?.createdBy,
    });
  };
}

function mutationError(res, reason) {
  if (reason === 'not_found') return notFound(res);
  if (reason === 'forbidden') return forbidden(res, 'Not allowed');
  return badRequest(res, reason);
}

function actorEmail(authedUser) {
  return String(authedUser?.email || '').trim().toLowerCase();
}

// GET /api/slide-collections/personal
async function handlePersonalList({ storageScope, res, authedUser }) {
  const out = await listPersonalCollections(storageScope, actorEmail(authedUser));
  serveJson(res, 200, out);
  return true;
}

// POST /api/slide-collections/personal
async function handlePersonalCreate({ storageScope, req, res, authedUser }) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await createPersonalCollection(storageScope, email, body, { actorEmail: email });
  if (!r.ok) return badRequest(res, r.reason);
  serveJson(res, 201, r.item);
  return true;
}

// GET /api/slide-collections/personal/:id
async function handlePersonalGet({ storageScope, res, authedUser }, id) {
  const item = await getPersonalCollection(storageScope, actorEmail(authedUser), id);
  if (!item) return notFound(res);
  serveJson(res, 200, item);
  return true;
}

// PATCH /api/slide-collections/personal/:id
async function handlePersonalUpdate({ storageScope, req, res, authedUser }, id) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await updatePersonalCollection(storageScope, email, id, body, { actorEmail: email });
  if (!r.ok) return mutationError(res, r.reason);
  serveJson(res, 200, r.item);
  return true;
}

// DELETE /api/slide-collections/personal/:id
async function handlePersonalDelete({ storageScope, res, authedUser }, id) {
  const r = await deletePersonalCollection(storageScope, actorEmail(authedUser), id);
  if (!r.ok) return notFound(res);
  serveJson(res, 200, { ok: true });
  return true;
}

// GET /api/slide-collections/organization
async function handleOrganizationList({ storageScope, res, authedUser }) {
  const out = await listOrganizationCollections(storageScope, { userEmail: actorEmail(authedUser) });
  serveJson(res, 200, out);
  return true;
}

// POST /api/slide-collections/organization
async function handleOrganizationCreate({ storageScope, req, res, authedUser }) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await createOrganizationCollection(storageScope, body, { actorEmail: email });
  if (!r.ok) return badRequest(res, r.reason);
  serveJson(res, 201, r.item);
  return true;
}

// GET /api/slide-collections/organization/:id
async function handleOrganizationGet({ storageScope, res, authedUser }, id) {
  const item = await getOrganizationCollection(storageScope, id, { userEmail: actorEmail(authedUser) });
  if (!item) return notFound(res);
  serveJson(res, 200, item);
  return true;
}

// PATCH /api/slide-collections/organization/:id
async function handleOrganizationUpdate({ storageScope, req, res, authedUser }, id) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await updateOrganizationCollection(storageScope, id, body, {
    actorEmail: actorEmail(authedUser),
    allowMutate: organizationMutateGuard(authedUser),
  });
  if (!r.ok) return mutationError(res, r.reason);
  serveJson(res, 200, r.item);
  return true;
}

// DELETE /api/slide-collections/organization/:id
async function handleOrganizationDelete({ storageScope, res, authedUser }, id) {
  const r = await deleteOrganizationCollection(storageScope, id, {
    actorEmail: actorEmail(authedUser),
    allowMutate: organizationMutateGuard(authedUser),
  });
  if (!r.ok) return mutationError(res, r.reason);
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
  { method: 'GET', pattern: '/api/slide-collections/personal', handler: handlePersonalList },
  { method: 'POST', pattern: '/api/slide-collections/personal', handler: handlePersonalCreate },
  { pattern: '/api/slide-collections/personal', handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']) },
  { method: 'GET', pattern: /^\/api\/slide-collections\/personal\/([^/]+)$/, handler: handlePersonalGet },
  { method: 'PATCH', pattern: /^\/api\/slide-collections\/personal\/([^/]+)$/, handler: handlePersonalUpdate },
  { method: 'DELETE', pattern: /^\/api\/slide-collections\/personal\/([^/]+)$/, handler: handlePersonalDelete },
  { pattern: /^\/api\/slide-collections\/personal\/([^/]+)$/, handler: ({ res }) => methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']) },
  { method: 'GET', pattern: '/api/slide-collections/organization', handler: handleOrganizationList },
  { method: 'POST', pattern: '/api/slide-collections/organization', handler: handleOrganizationCreate },
  { pattern: '/api/slide-collections/organization', handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']) },
  { method: 'GET', pattern: /^\/api\/slide-collections\/organization\/([^/]+)$/, handler: handleOrganizationGet },
  { method: 'PATCH', pattern: /^\/api\/slide-collections\/organization\/([^/]+)$/, handler: handleOrganizationUpdate },
  { method: 'DELETE', pattern: /^\/api\/slide-collections\/organization\/([^/]+)$/, handler: handleOrganizationDelete },
  { pattern: /^\/api\/slide-collections\/organization\/([^/]+)$/, handler: ({ res }) => methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']) },
];

/**
 * Handle slide-collection API routes. The module-wide guards (path prefix,
 * authentication) run before dispatch, exactly as the original chain did.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleSlideCollections = withErrorHandler('slide-collections', (ctx) => {
  if (!ctx.url.pathname.startsWith('/api/slide-collections')) return false;
  if (!ctx.authedUser) return unauthorized(ctx.res);
  return dispatchRoutes(ROUTES, ctx);
});
