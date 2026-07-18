/**
 * Slide collections API.
 *
 * A collection is a named, ordered, scoped set of slide-library item ids.
 * Personal collections are private to their owner; team collections are
 * workspace-wide and mutable by their creator or an admin (mirroring the
 * slide library's authz model).
 */

import {
  badRequest,
  json,
  methodNotAllowed,
  serveJson,
  unauthorized,
  notFound,
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
} from '../../storage/collections.js';

/**
 * Team collections may only be mutated by an admin or the creator.
 * @param {object} authedUser
 * @returns {(collection: object, ctx: { actorEmail: string }) => boolean}
 */
function teamMutateGuard(authedUser) {
  return (collection, { actorEmail }) => {
    if (authedUser?.isAdmin) return true;
    return (
      String(collection?.createdBy || '').toLowerCase() ===
      String(actorEmail || '').toLowerCase()
    );
  };
}

function mutationError(res, reason) {
  if (reason === 'not_found') return notFound(res);
  if (reason === 'forbidden') return unauthorized(res, 'Not allowed');
  return badRequest(res, reason);
}

export async function handleSlideCollections({ repoRoot, req, res, url, authedUser }) {
  if (!url.pathname.startsWith('/api/slide-collections')) return false;
  if (!authedUser) return unauthorized(res);

  const email = String(authedUser?.email || '').trim().toLowerCase();

  // Personal collections
  if (url.pathname === '/api/slide-collections/personal') {
    if (req.method === 'GET') {
      const out = await listPersonalCollections(repoRoot, email);
      serveJson(res, 200, out);
      return true;
    }
    if (req.method === 'POST') {
      const body = await json(req);
      const r = await createPersonalCollection(repoRoot, email, body, { actorEmail: email });
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
      const item = await getPersonalCollection(repoRoot, email, id);
      if (!item) return notFound(res);
      serveJson(res, 200, item);
      return true;
    }
    if (req.method === 'PATCH') {
      const body = await json(req);
      const r = await updatePersonalCollection(repoRoot, email, id, body, { actorEmail: email });
      if (!r.ok) return mutationError(res, r.reason);
      serveJson(res, 200, r.item);
      return true;
    }
    if (req.method === 'DELETE') {
      const r = await deletePersonalCollection(repoRoot, email, id);
      if (!r.ok) return notFound(res);
      serveJson(res, 200, { ok: true });
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']);
  }

  // Team collections (workspace-wide)
  if (url.pathname === '/api/slide-collections/team') {
    if (req.method === 'GET') {
      const out = await listTeamCollections(repoRoot, { userEmail: email });
      serveJson(res, 200, out);
      return true;
    }
    if (req.method === 'POST') {
      const body = await json(req);
      const r = await createTeamCollection(repoRoot, body, { actorEmail: email });
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
      const item = await getTeamCollection(repoRoot, id, { userEmail: email });
      if (!item) return notFound(res);
      serveJson(res, 200, item);
      return true;
    }
    if (req.method === 'PATCH') {
      const body = await json(req);
      const r = await updateTeamCollection(repoRoot, id, body, {
        actorEmail: email,
        allowMutate: teamMutateGuard(authedUser),
      });
      if (!r.ok) return mutationError(res, r.reason);
      serveJson(res, 200, r.item);
      return true;
    }
    if (req.method === 'DELETE') {
      const r = await deleteTeamCollection(repoRoot, id, {
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
