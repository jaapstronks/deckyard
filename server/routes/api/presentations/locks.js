import {
  forbidden,
  methodNotAllowed,
  notFound,
  serveJson,
  requireJsonBody,
} from '../../../utils/http.js';
import {
  acquirePresentationLock,
  getPresentationLock,
  refreshPresentationLock,
  releasePresentationLock,
  forceReleasePresentationLock,
  createLockRequest,
  listPendingLockRequests,
  getLockRequest,
  acceptLockRequest,
  rejectLockRequest,
  getUserLockRequestStatus,
} from '../../../utils/presentation-locks.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { createRouteContext } from '../../../utils/context.js';
import { matchesIdentity } from '../../../../shared/identity-match.js';

const getCtx = createRouteContext;

/**
 * Whether the authed user holds this lock — id-primary, e-mail fallback.
 * The one place the route decides "is this mine?", so every holder gate reads
 * the same rule (shared/identity-match.js) instead of a raw lowercased compare.
 *
 * @param {Object} [user] - The authed user ({ id, email })
 * @param {Object} [lock] - The lock, carrying holderId/holderEmail
 * @returns {boolean}
 */
function isLockHolder(user, lock) {
  if (!lock) return false;
  return matchesIdentity(user, { userId: lock.holderId, email: lock.holderEmail });
}

/** The identity an authed user carries into a lock write. */
function lockActor(authedUser) {
  return {
    email: authedUser?.email,
    name: authedUser?.name,
    userId: authedUser?.id || null,
  };
}

export async function handlePresentationLockStatus(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const lock = await getPresentationLock(ctx, id);

  // Check if the current user is the lock holder
  const isHolder = isLockHolder(authedUser, lock);

  // Also include user's pending request status if they have one
  let myRequest = null;
  if (authedUser?.email) {
    myRequest = await getUserLockRequestStatus(ctx, id, { email: authedUser.email, userId: authedUser?.id || null });
  }

  serveJson(res, 200, { ok: true, lock, myRequest, isHolder });
  return true;
}

export async function handlePresentationLockAcquire(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const result = await acquirePresentationLock(ctx, id, lockActor(authedUser));

  serveJson(res, result.ok ? 200 : 409, result);
  return true;
}

export async function handlePresentationLockRefresh(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const result = await refreshPresentationLock(ctx, id, { email: authedUser?.email, userId: authedUser?.id || null });

  // Include pending requests count if user is the holder
  let pendingRequestsCount = 0;
  if (result.ok && isLockHolder(authedUser, result.lock)) {
    const requests = await listPendingLockRequests(ctx, id);
    pendingRequestsCount = requests.length;
  }

  serveJson(res, result.ok ? 200 : 409, { ...result, pendingRequestsCount });
  return true;
}

export async function handlePresentationLockRelease(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const result = await releasePresentationLock(ctx, id, { email: authedUser?.email, userId: authedUser?.id || null });

  serveJson(res, result.ok ? 200 : 409, result);
  return true;
}

export async function handlePresentationLockForceRelease(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'forceLock' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const result = await forceReleasePresentationLock(ctx, id);

  serveJson(res, result.ok ? 200 : 500, result);
  return true;
}

// ============================================================
// LOCK REQUESTS
// ============================================================

export async function handlePresentationLockRequest(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const ctx = getCtx(authedUser);
  const result = await createLockRequest(ctx, id, {
    email: authedUser?.email,
    name: authedUser?.name,
    message: body?.message || '',
  });

  serveJson(res, result.ok ? 201 : 409, result);
  return true;
}

export async function handlePresentationLockRequestsList(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);

  // Verify user is the current lock holder
  const lock = await getPresentationLock(ctx, id);
  if (!isLockHolder(authedUser, lock)) {
    return forbidden(res, 'Only the current lock holder can view requests');
  }

  const requests = await listPendingLockRequests(ctx, id);
  serveJson(res, 200, { ok: true, requests });
  return true;
}

export async function handlePresentationLockRequestAccept(
  { repoRoot, req, res, authedUser } = {},
  id,
  requestId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);

  // Verify user is the current lock holder
  const lock = await getPresentationLock(ctx, id);
  if (!isLockHolder(authedUser, lock)) {
    return forbidden(res, 'Only the current lock holder can accept requests');
  }

  // Verify request belongs to this presentation
  const request = await getLockRequest(ctx, requestId);
  if (!request || request.presentationId !== id) {
    return notFound(res);
  }

  const result = await acceptLockRequest(ctx, requestId, {
    holderEmail: authedUser?.email,
  });

  serveJson(res, result.ok ? 200 : 400, result);
  return true;
}

export async function handlePresentationLockRequestReject(
  { repoRoot, req, res, authedUser } = {},
  id,
  requestId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);

  // Verify user is the current lock holder
  const lock = await getPresentationLock(ctx, id);
  if (!isLockHolder(authedUser, lock)) {
    return forbidden(res, 'Only the current lock holder can reject requests');
  }

  // Verify request belongs to this presentation
  const request = await getLockRequest(ctx, requestId);
  if (!request || request.presentationId !== id) {
    return notFound(res);
  }

  const result = await rejectLockRequest(ctx, requestId);

  serveJson(res, result.ok ? 200 : 400, result);
  return true;
}

export async function handlePresentationLockMyRequest(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const request = await getUserLockRequestStatus(ctx, id, { email: authedUser?.email, userId: authedUser?.id || null });

  serveJson(res, 200, { ok: true, request });
  return true;
}