import {
  forbidden,
  json,
  methodNotAllowed,
  notFound,
  serveJson,
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

const getCtx = createRouteContext;

export async function handlePresentationLockStatus(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const lock = await getPresentationLock(id, ctx);

  // Check if the current user is the lock holder
  const isHolder = lock && authedUser?.email &&
    lock.holderEmail === authedUser.email.toLowerCase();

  // Also include user's pending request status if they have one
  let myRequest = null;
  if (authedUser?.email) {
    myRequest = await getUserLockRequestStatus(id, { email: authedUser.email }, ctx);
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
  const result = await acquirePresentationLock(id, {
    email: authedUser?.email,
    name: authedUser?.name,
  }, ctx);

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
  const result = await refreshPresentationLock(id, { email: authedUser?.email }, ctx);

  // Include pending requests count if user is the holder
  let pendingRequestsCount = 0;
  if (result.ok && result.lock?.holderEmail === authedUser?.email?.toLowerCase()) {
    const requests = await listPendingLockRequests(id, ctx);
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
  const result = await releasePresentationLock(id, { email: authedUser?.email }, ctx);

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
  const result = await forceReleasePresentationLock(id, ctx);

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

  const body = await json(req);
  const ctx = getCtx(authedUser);
  const result = await createLockRequest(id, {
    email: authedUser?.email,
    name: authedUser?.name,
    message: body?.message || '',
  }, ctx);

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
  const lock = await getPresentationLock(id, ctx);
  if (!lock || lock.holderEmail !== authedUser?.email?.toLowerCase()) {
    return forbidden(res, 'Only the current lock holder can view requests');
  }

  const requests = await listPendingLockRequests(id, ctx);
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
  const lock = await getPresentationLock(id, ctx);
  if (!lock || lock.holderEmail !== authedUser?.email?.toLowerCase()) {
    return forbidden(res, 'Only the current lock holder can accept requests');
  }

  // Verify request belongs to this presentation
  const request = await getLockRequest(requestId, ctx);
  if (!request || request.presentationId !== id) {
    return notFound(res);
  }

  const result = await acceptLockRequest(requestId, {
    holderEmail: authedUser?.email,
  }, ctx);

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
  const lock = await getPresentationLock(id, ctx);
  if (!lock || lock.holderEmail !== authedUser?.email?.toLowerCase()) {
    return forbidden(res, 'Only the current lock holder can reject requests');
  }

  // Verify request belongs to this presentation
  const request = await getLockRequest(requestId, ctx);
  if (!request || request.presentationId !== id) {
    return notFound(res);
  }

  const result = await rejectLockRequest(requestId, ctx);

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
  const request = await getUserLockRequestStatus(id, { email: authedUser?.email }, ctx);

  serveJson(res, 200, { ok: true, request });
  return true;
}