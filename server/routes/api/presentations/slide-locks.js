/**
 * API routes for slide-level locking.
 * Enables concurrent editing by allowing users to lock individual slides
 * instead of entire presentations.
 */

import {
  getErrorStatus,
  jsonError,
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
import { matchesIdentity } from '../../../../shared/identity-match.js';

/** The identity an authed user carries into a slide-lock write. */
function lockActor(authedUser) {
  return {
    email: authedUser?.email,
    name: authedUser?.name,
    userId: authedUser?.id || null,
  };
}

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
 * Serve an acquire/refresh/release result. The 200s (success and the
 * deliberate soft-fails described on `lockHttpStatus`) keep the raw result
 * body; only the genuine `held` conflict is an HTTP error and answers in the
 * canonical envelope, with the competing lock in `details.lock`.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{ok?: boolean, reason?: string, lock?: Object}} result
 * @returns {true}
 */
function serveLockResult(res, result) {
  const status = lockHttpStatus(result);
  if (status !== 200) {
    return jsonError(res, status, result.reason, undefined, {
      details: result.lock ? { lock: result.lock } : undefined,
    });
  }
  serveJson(res, 200, result);
  return true;
}

/**
 * GET /api/presentations/:id/slide-locks
 * List all active slide locks for a presentation.
 */
export async function handleSlideLocksList(
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const locks = await getSlideLocks(storageScope, id);

  // Also include list of slides locked by others (for UI)
  const lockedByOthers = authedUser?.email
    ? await getLockedByOthers(storageScope, id, { email: authedUser.email, userId: authedUser?.id || null })
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
  { storageScope, req, res, authedUser } = {},
  presentationId,
  slideId
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const lock = await getSlideLock(storageScope, presentationId, slideId);

  const isHolder =
    !!lock && matchesIdentity(authedUser, { userId: lock.holderId, email: lock.holderEmail });

  serveJson(res, 200, { ok: true, lock, isHolder });
  return true;
}

/**
 * POST /api/presentations/:id/slides/:slideId/lock
 * Acquire a lock on a slide.
 */
export async function handleSlideLockAcquire(
  { storageScope, req, res, authedUser } = {},
  presentationId,
  slideId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const result = await acquireSlideLock(storageScope, presentationId, slideId, lockActor(authedUser));

  // Broadcast lock event to other clients. `result.lock` carries holderId
  // alongside holderEmail/holderName, so listeners decide "is this mine?" on
  // the stable id (shared/identity-match.js), not a raw e-mail compare.
  if (result.ok) {
    broadcastToPresentation(presentationId, SlideLockEventTypes.LOCKED, {
      slideId,
      lock: result.lock,
    });
  }

  return serveLockResult(res, result);
}

/**
 * POST /api/presentations/:id/slides/:slideId/lock/refresh
 * Refresh (extend) an existing slide lock.
 */
export async function handleSlideLockRefresh(
  { storageScope, req, res, authedUser } = {},
  presentationId,
  slideId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const result = await refreshSlideLock(storageScope, presentationId, slideId, {
    email: authedUser?.email,
    userId: authedUser?.id || null,
  });

  return serveLockResult(res, result);
}

/**
 * DELETE /api/presentations/:id/slides/:slideId/lock
 * Release a slide lock.
 */
export async function handleSlideLockRelease(
  { storageScope, req, res, authedUser } = {},
  presentationId,
  slideId
) {
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return methodNotAllowed(res, ['DELETE', 'POST']);
  }
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const result = await releaseSlideLock(storageScope, presentationId, slideId, {
    email: authedUser?.email,
    userId: authedUser?.id || null,
  });

  // Broadcast unlock event to other clients. The payload carries only the
  // slide: `releasedBy` was never read by any client (the receiver deletes the
  // lock and clears the indicator regardless of who released it), so the
  // beta-stance drops the unused actor rather than dressing it up as a pair.
  if (result.ok && result.released) {
    broadcastToPresentation(presentationId, SlideLockEventTypes.UNLOCKED, {
      slideId,
    });
  }

  return serveLockResult(res, result);
}

/**
 * POST /api/presentations/:id/slide-locks/release-all
 * Release all slide locks held by the current user.
 * Used when user navigates away or closes the editor.
 */
export async function handleSlideLocksReleaseAll(
  { storageScope, req, res, authedUser } = {},
  presentationId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const result = await releaseAllUserSlideLocks(storageScope, presentationId, {
    email: authedUser?.email,
    userId: authedUser?.id || null,
  });

  // Broadcast that locks have changed. Listeners re-fetch the whole lock set on
  // this event, so who released them is not consulted — `releasedBy` was dead
  // weight and is dropped (same beta-stance call as slide:unlocked above).
  if (result.ok && result.releasedCount > 0) {
    broadcastToPresentation(presentationId, SlideLockEventTypes.LOCKS_CHANGED, {
      count: result.releasedCount,
    });
  }

  // "Nothing to release because there is no lock backend" is a no-op, not a
  // server error — otherwise editor teardown logs a 500 on file storage.
  if (!result.ok && result.reason !== 'unavailable') {
    return jsonError(res, getErrorStatus(result.reason, 500), result.reason || 'internal_error');
  }
  serveJson(res, 200, result);
  return true;
}