import {
  forbidden,
  getErrorStatus,
  jsonError,
  methodNotAllowed,
  notFound,
  serveJson,
  requireJsonBody,
} from '../../../utils/http.js';

/**
 * Answer a failed lock-storage result in the canonical envelope.
 *
 * The machine code is the storage reason, the status comes from
 * `ERROR_STATUS_MAP` (held/already_* → 409, not_found → 404, unavailable →
 * 503, caller-side reasons → 400). When the result carries the current lock
 * (a `held` refusal), it rides along as `details.lock` so the client can show
 * who holds it without a second round-trip.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{reason?: string, lock?: Object}} result
 * @param {number} [defaultStatus]
 * @returns {true}
 */
function lockError(res, result, defaultStatus = 400) {
  const code = result?.reason || 'internal_error';
  return jsonError(res, getErrorStatus(code, defaultStatus), code, undefined, {
    details: result?.lock ? { lock: result.lock } : undefined,
  });
}
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
import { matchesIdentity } from '../../../../shared/identity-match.js';

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
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const lock = await getPresentationLock(storageScope, id);

  // Check if the current user is the lock holder
  const isHolder = isLockHolder(authedUser, lock);

  // Also include user's pending request status if they have one
  let myRequest = null;
  if (authedUser?.email) {
    myRequest = await getUserLockRequestStatus(storageScope, id, { email: authedUser.email, userId: authedUser?.id || null });
  }

  serveJson(res, 200, { ok: true, lock, myRequest, isHolder });
  return true;
}

export async function handlePresentationLockAcquire(
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const result = await acquirePresentationLock(storageScope, id, lockActor(authedUser));

  if (!result.ok) return lockError(res, result);
  serveJson(res, 200, result);
  return true;
}

export async function handlePresentationLockRefresh(
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const result = await refreshPresentationLock(storageScope, id, { email: authedUser?.email, userId: authedUser?.id || null });

  // Include pending requests count if user is the holder
  let pendingRequestsCount = 0;
  if (result.ok && isLockHolder(authedUser, result.lock)) {
    const requests = await listPendingLockRequests(storageScope, id);
    pendingRequestsCount = requests.length;
  }

  if (!result.ok) return lockError(res, result);
  serveJson(res, 200, { ...result, pendingRequestsCount });
  return true;
}

export async function handlePresentationLockRelease(
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const result = await releasePresentationLock(storageScope, id, { email: authedUser?.email, userId: authedUser?.id || null });

  if (!result.ok) return lockError(res, result);
  serveJson(res, 200, result);
  return true;
}

export async function handlePresentationLockForceRelease(
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'forceLock' });
  if (!pres) return true;

  const result = await forceReleasePresentationLock(storageScope, id);

  // Force-release failing is our side (no lock backend), never the caller's.
  if (!result.ok) return lockError(res, result, 500);
  serveJson(res, 200, result);
  return true;
}

// ============================================================
// LOCK REQUESTS
// ============================================================

export async function handlePresentationLockRequest(
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const result = await createLockRequest(storageScope, id, {
    email: authedUser?.email,
    name: authedUser?.name,
    message: body?.message || '',
  });

  if (!result.ok) return lockError(res, result);
  serveJson(res, 201, result);
  return true;
}

export async function handlePresentationLockRequestsList(
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;


  // Verify user is the current lock holder
  const lock = await getPresentationLock(storageScope, id);
  if (!isLockHolder(authedUser, lock)) {
    return forbidden(res, 'Only the current lock holder can view requests');
  }

  const requests = await listPendingLockRequests(storageScope, id);
  serveJson(res, 200, { ok: true, requests });
  return true;
}

export async function handlePresentationLockRequestAccept(
  { storageScope, req, res, authedUser } = {},
  id,
  requestId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;


  // Verify user is the current lock holder
  const lock = await getPresentationLock(storageScope, id);
  if (!isLockHolder(authedUser, lock)) {
    return forbidden(res, 'Only the current lock holder can accept requests');
  }

  // Verify request belongs to this presentation
  const request = await getLockRequest(storageScope, requestId);
  if (!request || request.presentationId !== id) {
    return notFound(res);
  }

  const result = await acceptLockRequest(storageScope, requestId, {
    holderEmail: authedUser?.email,
  });

  if (!result.ok) return lockError(res, result);
  serveJson(res, 200, result);
  return true;
}

export async function handlePresentationLockRequestReject(
  { storageScope, req, res, authedUser } = {},
  id,
  requestId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;


  // Verify user is the current lock holder
  const lock = await getPresentationLock(storageScope, id);
  if (!isLockHolder(authedUser, lock)) {
    return forbidden(res, 'Only the current lock holder can reject requests');
  }

  // Verify request belongs to this presentation
  const request = await getLockRequest(storageScope, requestId);
  if (!request || request.presentationId !== id) {
    return notFound(res);
  }

  const result = await rejectLockRequest(storageScope, requestId);

  if (!result.ok) return lockError(res, result);
  serveJson(res, 200, result);
  return true;
}

export async function handlePresentationLockMyRequest(
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const request = await getUserLockRequestStatus(storageScope, id, { email: authedUser?.email, userId: authedUser?.id || null });

  serveJson(res, 200, { ok: true, request });
  return true;
}