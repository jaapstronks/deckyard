/**
 * Trash API routes for soft-deleted presentations.
 */

import { permanentlyDeletePresentation } from '../../../services/permanent-delete.js';
import {
  listTrashPage,
  restorePresentation,
} from '../../../services/presentations.js';
import {
  methodNotAllowed,
  serveJson,
  storageError,
} from '../../../utils/http.js';
import { withDeckCardFields } from '../../../utils/deck-card-fields.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';

/**
 * Human copy per failure the permanent-delete seam can report. A map rather
 * than a branch on the reason: the status already comes from the REASONS
 * register, and only the sentence is this route's business.
 */
const PERMANENT_DELETE_FAILURE_MESSAGES = {
  not_found: 'Presentation not found',
  not_trashed: 'Presentation is not in trash',
};

/**
 * GET /api/presentations/trash - One page of the trashed decks the session
 * user may restore, on the list-page contract (D358, B821):
 * `{ presentations, nextCursor }`, most recently trashed first.
 */
export async function handlePresentationsTrashList({
  repoRoot,
  storageScope,
  req,
  res,
  url,
  authedUser,
}) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  const params = url.searchParams;
  const { presentations, nextCursor } = await listTrashPage(
    storageScope,
    { actor: authedUser },
    {
      limit: params.get('limit') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
      ...(params.has('offset') ? { offset: params.get('offset') } : {}),
    },
  );

  serveJson(res, 200, {
    presentations: await withDeckCardFields(
      repoRoot,
      presentations,
      storageScope,
    ),
    nextCursor,
  });
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

  const restored = await restorePresentation(
    storageScope,
    { actor: authedUser },
    id,
  );
  serveJson(res, 200, restored);
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

  // Permanent deletion is the owner's, as moving to the trash is (D49).
  const existing = await withPresentationAuth({
    storageScope,
    id,
    authedUser,
    res,
    permission: 'delete',
  });
  if (!existing) return true;

  const deleted = await permanentlyDeletePresentation({
    repoRoot,
    storageScope,
    id,
  });
  if (!deleted.ok) {
    return storageError(
      res,
      deleted,
      PERMANENT_DELETE_FAILURE_MESSAGES[deleted.reason],
    );
  }

  serveJson(res, 200, { ok: true });
  return true;
}
