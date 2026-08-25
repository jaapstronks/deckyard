/**
 * Trash API routes for soft-deleted presentations.
 */

import {
  listTrashedPresentations,
  restorePresentation,
  permanentlyDeletePresentation,
  getPresentation,
} from '../../../storage/presentations/index.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  forbidden,
  badRequest,
} from '../../../utils/http.js';
import { canDeletePresentation } from '../../../utils/presentation-authz/index.js';
import {
  isOwnerOrCreator,
  matchesIdentity,
} from '../../../../shared/identity-match.js';

/**
 * GET /api/presentations/trash - List trashed presentations
 */
export async function handlePresentationsTrashList({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
}) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  const items = await listTrashedPresentations(storageScope);

  // Filter to only show items the user can see (owner, creator, trasher, or
  // admin). Identity is matched through shared/identity-match.js, on the stable
  // `users.id` and nothing else, so a renamed user still sees the items they
  // own or trashed (T10 PR F2).
  const filtered = items.filter((p) => {
    if (authedUser?.isAdmin) return true;
    return (
      isOwnerOrCreator(authedUser, p) ||
      matchesIdentity(authedUser, { userId: p.trashedBy?.id })
    );
  });

  serveJson(res, 200, filtered);
  return true;
}

/**
 * POST /api/presentations/:id/restore - Restore a presentation from trash
 */
export async function handlePresentationRestore(
  { repoRoot, storageScope, req, res, authedUser },
  id,
) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  // First check if the presentation exists and is in trash
  const existing = await getPresentation(storageScope, id);
  if (!existing) {
    return notFound(res);
  }

  // Check if presentation is actually trashed
  if (!existing.trashedAt) {
    return badRequest(res, 'Presentation is not in trash');
  }

  // Check authorization: owner, creator, trasher, or admin. Matched through
  // shared/identity-match.js on the stable `users.id`, so a rename does not
  // strip the trasher of their restore right (T10 PR F2).
  const canRestore =
    authedUser?.isAdmin ||
    isOwnerOrCreator(authedUser, existing) ||
    matchesIdentity(authedUser, { userId: existing.trashedBy?.id });

  if (!canRestore) {
    return forbidden(
      res,
      'You do not have permission to restore this presentation',
    );
  }

  const restored = await restorePresentation(storageScope, id);
  if (!restored.ok) {
    return notFound(res);
  }

  serveJson(res, 200, restored.presentation);
  return true;
}

/**
 * DELETE /api/presentations/:id/permanent - Permanently delete a presentation
 */
export async function handlePresentationPermanentDelete(
  { repoRoot, storageScope, req, res, authedUser },
  id,
) {
  if (req.method !== 'DELETE') {
    return methodNotAllowed(res, ['DELETE']);
  }

  // First check if the presentation exists
  const existing = await getPresentation(storageScope, id);
  if (!existing) {
    return notFound(res);
  }

  // Check authorization using existing canDeletePresentation helper
  // This checks: owner, creator, or admin
  if (!canDeletePresentation({ user: authedUser, pres: existing })) {
    return forbidden(
      res,
      'You do not have permission to permanently delete this presentation',
    );
  }

  const deleted = await permanentlyDeletePresentation(storageScope, id);
  if (!deleted) {
    return notFound(res);
  }

  serveJson(res, 200, { ok: true });
  return true;
}
