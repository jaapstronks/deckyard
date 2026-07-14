/**
 * API routes for slide-level locking.
 * Enables concurrent editing by allowing users to lock individual slides
 * instead of entire presentations.
 */

import {
  json,
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

  serveJson(res, result.ok ? 200 : 409, result);
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

  serveJson(res, result.ok ? 200 : 409, result);
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

  serveJson(res, result.ok ? 200 : 409, result);
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

  serveJson(res, result.ok ? 200 : 500, result);
  return true;
}