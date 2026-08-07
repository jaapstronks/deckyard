/**
 * Slide collections API.
 *
 * A collection is a named, ordered, scoped set of slide-library item ids.
 * Personal collections are private to their owner; team collections are
 * organization-wide and mutable by their creator or an admin (mirroring the
 * slide library's authz model).
 */

import {
  badRequest,
  methodNotAllowed,
  serveJson,
  unauthorized,
  notFound,
  requireJsonBody,
} from '../../utils/http.js';
import {
  listPersonalCollections,
  getPersonalCollection,
  createPersonalCollection,
  updatePersonalCollection,
  deletePersonalCollection,
  listTeamCollections,
  getTeamCollection,
  createTeamCollection,
  updateTeamCollection,
  deleteTeamCollection,
} from '../../storage/collections/index.js';
import { matchesIdentity } from '../../../shared/identity-match.js';

/**
 * Team collections may only be mutated by an admin or the creator.
 *
 * Identity is matched through shared/identity-match.js (id-first, e-mail
 * fallback) rather than raw lowercased e-mail, so the creator keeps their
 * mutate right across a rename (T10 PR F2).
 * @param {object} authedUser
 * @returns {(collection: object) => boolean}
 */
function teamMutateGuard(authedUser) {
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
  if (reason === 'forbidden') return unauthorized(res, 'Not allowed');
  return badRequest(res, reason);
}

export async function handleSlideCollections({ storageScope, req, res, url, authedUser }) {
  if (!url.pathname.startsWith('/api/slide-collections')) return false;
  if (!authedUser) return unauthorized(res);

  const email = String(authedUser?.email || '').trim().toLowerCase();

  // Personal collections
  if (url.pathname === '/api/slide-collections/personal') {
    if (req.method === 'GET') {
      const out = await listPersonalCollections(storageScope, email);
      serveJson(res, 200, out);
      return true;
    }
    if (req.method === 'POST') {
      const parsed = await requireJsonBody(req, res);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const r = await createPersonalCollection(storageScope, email, body, { actorEmail: email });
      if (!r.ok) return badRequest(res, r.reason);
      serveJson(res, 201, r.item);
      return true;
    }
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  const personalIdMatch = url.pathname.match(/^\/api\/slide-collections\/personal\/([^/]+)$/);
  if (personalIdMatch) {
    const id = personalIdMatch[1];
    if (req.method === 'GET') {
      const item = await getPersonalCollection(storageScope, email, id);
      if (!item) return notFound(res);
      serveJson(res, 200, item);
      return true;
    }
    if (req.method === 'PATCH') {
      const parsed = await requireJsonBody(req, res);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const r = await updatePersonalCollection(storageScope, email, id, body, { actorEmail: email });
      if (!r.ok) return mutationError(res, r.reason);
      serveJson(res, 200, r.item);
      return true;
    }
    if (req.method === 'DELETE') {
      const r = await deletePersonalCollection(storageScope, email, id);
      if (!r.ok) return notFound(res);
      serveJson(res, 200, { ok: true });
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']);
  }

  // Team collections (organization-wide)
  if (url.pathname === '/api/slide-collections/team') {
    if (req.method === 'GET') {
      const out = await listTeamCollections(storageScope, { userEmail: email });
      serveJson(res, 200, out);
      return true;
    }
    if (req.method === 'POST') {
      const parsed = await requireJsonBody(req, res);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const r = await createTeamCollection(storageScope, body, { actorEmail: email });
      if (!r.ok) return badRequest(res, r.reason);
      serveJson(res, 201, r.item);
      return true;
    }
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  const teamIdMatch = url.pathname.match(/^\/api\/slide-collections\/team\/([^/]+)$/);
  if (teamIdMatch) {
    const id = teamIdMatch[1];
    if (req.method === 'GET') {
      const item = await getTeamCollection(storageScope, id, { userEmail: email });
      if (!item) return notFound(res);
      serveJson(res, 200, item);
      return true;
    }
    if (req.method === 'PATCH') {
      const parsed = await requireJsonBody(req, res);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const r = await updateTeamCollection(storageScope, id, body, {
        actorEmail: email,
        allowMutate: teamMutateGuard(authedUser),
      });
      if (!r.ok) return mutationError(res, r.reason);
      serveJson(res, 200, r.item);
      return true;
    }
    if (req.method === 'DELETE') {
      const r = await deleteTeamCollection(storageScope, id, {
        actorEmail: email,
        allowMutate: teamMutateGuard(authedUser),
      });
      if (!r.ok) return mutationError(res, r.reason);
      serveJson(res, 200, { ok: true });
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']);
  }

  return false;
}
