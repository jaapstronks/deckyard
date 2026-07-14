/**
 * Trash API routes for soft-deleted presentations.
 */

import {
  listTrashedPresentations,
  restorePresentation,
  permanentlyDeletePresentation,
  getPresentation,
} from '../../../storage/presentations.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
} from '../../../utils/http.js';
import { canDeletePresentation } from '../../../utils/presentation-authz.js';

/**
 * GET /api/presentations/trash - List trashed presentations
 */
export async function handlePresentationsTrashList({ repoRoot, req, res, authedUser }) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  const items = await listTrashedPresentations(repoRoot);

  // Filter to only show items the user can see (owner, creator, or admin)
  const filtered = items.filter((p) => {
    // Admins can see all trashed presentations
    if (authedUser?.isAdmin) return true;
    // Owners and creators can see their trashed presentations
    const email = authedUser?.email?.toLowerCase();
    if (!email) return false;
    return (
      p.ownerEmail?.toLowerCase() === email ||
      p.createdBy?.toLowerCase() === email ||
      p.trashedBy?.toLowerCase() === email
    );
  });

  serveJson(res, 200, filtered);
  return true;
}

/**
 * POST /api/presentations/:id/restore - Restore a presentation from trash
 */
export async function handlePresentationRestore({ repoRoot, req, res, authedUser }, id) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  // First check if the presentation exists and is in trash
  const existing = await getPresentation(repoRoot, id);
  if (!existing) {
    return notFound(res);
  }

  // Check if presentation is actually trashed
  if (!existing.trashedAt) {
    return serveJson(res, 400, { error: 'Presentation is not in trash' });
  }

  // Check authorization: owner, creator, trashedBy, or admin
  const email = authedUser?.email?.toLowerCase();
  const canRestore =
    authedUser?.isAdmin ||
    existing.ownerEmail?.toLowerCase() === email ||
    existing.createdBy?.toLowerCase() === email ||
    existing.trashedBy?.toLowerCase() === email;

  if (!canRestore) {
    return serveJson(res, 403, { error: 'You do not have permission to restore this presentation' });
  }

  const restored = await restorePresentation(repoRoot, id);
  if (!restored) {
    return notFound(res);
  }

  serveJson(res, 200, restored);
  return true;
}

/**
 * DELETE /api/presentations/:id/permanent - Permanently delete a presentation
 */
export async function handlePresentationPermanentDelete({ repoRoot, req, res, authedUser }, id) {
  if (req.method !== 'DELETE') {
    return methodNotAllowed(res, ['DELETE']);
  }

  // First check if the presentation exists
  const existing = await getPresentation(repoRoot, id);
  if (!existing) {
    return notFound(res);
  }

  // Check authorization using existing canDeletePresentation helper
  // This checks: owner, creator, or admin
  if (!canDeletePresentation({ user: authedUser, pres: existing })) {
    return serveJson(res, 403, { error: 'You do not have permission to permanently delete this presentation' });
  }

  const deleted = await permanentlyDeletePresentation(repoRoot, id);
  if (!deleted) {
    return notFound(res);
  }

  serveJson(res, 200, { ok: true });
  return true;
}