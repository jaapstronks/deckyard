/**
 * Trash API routes for soft-deleted presentations.
 */

import { listTrashedPresentations } from '../../../storage/presentations/index.js';
import { permanentlyDeletePresentation } from '../../../services/permanent-delete.js';
import { restorePresentation } from '../../../services/presentations.js';
import {
  methodNotAllowed,
  serveJson,
  storageError,
} from '../../../utils/http.js';
import { withDeckCardFields } from '../../../utils/deck-card-fields.js';
import { canRestorePresentation } from '../../../utils/presentation-authz/index.js';
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

  const filtered = items.filter((pres) =>
    canRestorePresentation({ user: authedUser, pres }),
  );

  serveJson(
    res,
    200,
    await withDeckCardFields(repoRoot, filtered, storageScope),
  );
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
