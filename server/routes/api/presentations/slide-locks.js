/**
 * API routes for slide-level locking.
 * Enables concurrent editing by allowing users to lock individual slides
 * instead of entire presentations.
 */

import {
  methodNotAllowed,
  serveJson,
} from '../../../utils/http.js';
import {
  acquireSlideLock,
  releaseSlideLock,
  refreshSlideLock,
  getSlideLocks,
  getSlideLock,
  releaseAllUserSlideLocks,
  getLockedByOthers,
} from '../../../storage/slide-locks.js';
import {
  broadcastToPresentation,
  SlideLockEventTypes,
} from '../../../services/comment-events.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { createRouteContext } from '../../../utils/context.js';

const getCtx = createRouteContext;

/**
 * HTTP status for a slide-lock acquire/refresh/release result.
 *
 * Only a genuine contention (`held` — someone else owns the lock) is a real
 * 409 Conflict. Every other non-ok outcome is *not* a conflict: the lock
 * backend being unavailable (file storage has no lock DB), or an
 * invalid/expired/missing request. Mapping those to 409 made a single-operator
 * file-storage editor log a misleading "409 Conflict" on every slide open, with
 * no one to conflict with. Those return 200 with the reason in the body so the
 * client proceeds quietly (locking is simply a no-op on that backend).
 *
 * @param {{ok?: boolean, reason?: string}} result
 * @returns {number}
 */
export function lockHttpStatus(result) {
  if (result?.ok) return 200;
  return result?.reason === 'held' ? 409 : 200;
}

/**
 * GET /api/presentations/:id/slide-locks
 * List all active slide locks for a presentation.
 */
export async function handleSlideLocksList(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const locks = await getSlideLocks(id, ctx);

  // Also include list of slides locked by others (for UI)
  const lockedByOthers = authedUser?.email
    ? await getLockedByOthers(id, { email: authedUser.email }, ctx)
    : [];

  serveJson(res, 200, {
    ok: true,
    locks,
    lockedByOthers: lockedByOthers.map((l) => l.slideId),
  });
  return true;
}

/**
 * GET /api/presentations/:id/slides/:slideId/lock
 * Get lock status for a specific slide.
 */
export async function handleSlideLockStatus(
  { repoRoot, req, res, authedUser } = {},
  presentationId,
  slideId
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({
    repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const lock = await getSlideLock(presentationId, slideId, ctx);

  const isHolder =
    lock &&
    authedUser?.email &&
    lock.holderEmail === authedUser.email.toLowerCase();

  serveJson(res, 200, { ok: true, lock, isHolder });
  return true;
}

/**
 * POST /api/presentations/:id/slides/:slideId/lock
 * Acquire a lock on a slide.
 */
export async function handleSlideLockAcquire(
  { repoRoot, req, res, authedUser } = {},
  presentationId,
  slideId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({
    repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const result = await acquireSlideLock(
    presentationId,
    slideId,
    {
      email: authedUser?.email,
      name: authedUser?.name,
    },
    ctx
  );

  // Broadcast lock event to other clients
  if (result.ok) {
    broadcastToPresentation(presentationId, SlideLockEventTypes.LOCKED, {
      slideId,
      lock: result.lock,
    });
  }

  serveJson(res, lockHttpStatus(result), result);
  return true;
}

/**
 * POST /api/presentations/:id/slides/:slideId/lock/refresh
 * Refresh (extend) an existing slide lock.
 */
export async function handleSlideLockRefresh(
  { repoRoot, req, res, authedUser } = {},
  presentationId,
  slideId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({
    repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const result = await refreshSlideLock(
    presentationId,
    slideId,
    { email: authedUser?.email },
    ctx
  );

  serveJson(res, lockHttpStatus(result), result);
  return true;
}

/**
 * DELETE /api/presentations/:id/slides/:slideId/lock
 * Release a slide lock.
 */
export async function handleSlideLockRelease(
  { repoRoot, req, res, authedUser } = {},
  presentationId,
  slideId
) {
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return methodNotAllowed(res, ['DELETE', 'POST']);
  }
  const pres = await withPresentationAuth({
    repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const result = await releaseSlideLock(
    presentationId,
    slideId,
    { email: authedUser?.email },
    ctx
  );

  // Broadcast unlock event to other clients
  if (result.ok && result.released) {
    broadcastToPresentation(presentationId, SlideLockEventTypes.UNLOCKED, {
      slideId,
      releasedBy: authedUser?.email,
    });
  }

  serveJson(res, lockHttpStatus(result), result);
  return true;
}

/**
 * POST /api/presentations/:id/slide-locks/release-all
 * Release all slide locks held by the current user.
 * Used when user navigates away or closes the editor.
 */
export async function handleSlideLocksReleaseAll(
  { repoRoot, req, res, authedUser } = {},
  presentationId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({
    repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const result = await releaseAllUserSlideLocks(
    presentationId,
    { email: authedUser?.email },
    ctx
  );

  // Broadcast that locks have changed
  if (result.ok && result.releasedCount > 0) {
    broadcastToPresentation(presentationId, SlideLockEventTypes.LOCKS_CHANGED, {
      releasedBy: authedUser?.email,
      count: result.releasedCount,
    });
  }

  // "Nothing to release because there is no lock backend" is a no-op, not a
  // server error — otherwise editor teardown logs a 500 on file storage.
  const status = result.ok || result.reason === 'unavailable' ? 200 : 500;
  serveJson(res, status, result);
  return true;
}