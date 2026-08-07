/**
 * Database-backed presentation locks for turn-based editing.
 * Replaces in-memory locks with persistent PostgreSQL storage.
 */

import { getOrgId } from '../utils/context.js';
import { norm, nowIso, isoAfter } from '../utils/normalize.js';
import { matchesIdentity } from '../../shared/identity-match.js';
import { resolveIdentityByEmail } from './identity-resolver.js';
import { withDbGuard } from './utils/db-guard.js';

const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ============================================================
// ROW MAPPERS - Convert database rows to API objects
// ============================================================

/**
 * Map a presentation_locks row to a lock object.
 * @param {Object} row - Database row from presentation_locks table
 * @returns {Object} Lock object for API response
 */
function mapLockRow(row) {
  return {
    presentationId: row.presentation_id,
    holderId: row.holder_user_id || null,
    holderEmail: row.holder_email,
    holderName: row.holder_name,
    acquiredAt: row.acquired_at,
    refreshedAt: row.refreshed_at,
    expiresAt: row.expires_at,
  };
}

/**
 * The identity stamp on a lock row, as {@link matchesIdentity} expects it.
 * @param {Object} row - A presentation_locks row
 * @returns {{userId: string|null, email: string}}
 */
function holderStamp(row) {
  return { userId: row.holder_user_id || null, email: row.holder_email };
}

/**
 * Map a lock_requests row to a request object.
 * @param {Object} row - Database row from lock_requests table
 * @returns {Object} Request object for API response
 */
function mapRequestRow(row) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || null,
  };
}

// ============================================================
// PRESENTATION LOCKS
// ============================================================

/**
 * Get the current lock for a presentation.
 * Returns null if no lock exists or lock is expired.
 */
export async function getPresentationLock(presentationId, ctx) {
  const pid = norm(presentationId);
  if (!pid) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    const row = await db
      .selectFrom('presentation_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('expires_at', '>', now)
      .executeTakeFirst();

    if (!row) return null;

    return mapLockRow(row);
  });
}

/**
 * Acquire a lock for editing a presentation.
 * If the same user already holds the lock, refreshes it.
 * Returns { ok: true, lock } on success, { ok: false, reason, lock? } on failure.
 */
export async function acquirePresentationLock(presentationId, { email, name, userId } = {}, ctx) {
  const pid = norm(presentationId);
  const holderEmail = norm(email).toLowerCase();
  const holderName = norm(name) || holderEmail;
  const holderId = userId || null;
  const actor = { id: holderId, email: holderEmail };

  if (!pid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();
    const expiresAt = isoAfter(LOCK_TTL_MS);

    // Check for existing non-expired lock
    const existing = await db
      .selectFrom('presentation_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('expires_at', '>', now)
      .executeTakeFirst();

    if (existing) {
      // If held by someone else, return error (id-primary, e-mail fallback)
      if (!matchesIdentity(actor, holderStamp(existing))) {
        return {
          ok: false,
          reason: 'held',
          lock: mapLockRow(existing),
        };
      }

      // Same user - refresh the lock, re-stamping both identity halves so a
      // holder who renamed brings the row's e-mail back in step with their id.
      const updated = await db
        .updateTable('presentation_locks')
        .set({
          holder_user_id: holderId,
          holder_email: holderEmail,
          holder_name: holderName,
          refreshed_at: now,
          expires_at: expiresAt,
        })
        .where('presentation_id', '=', pid)
        .where('organization_id', '=', orgId)
        .returningAll()
        .executeTakeFirst();

      return {
        ok: true,
        lock: mapLockRow(updated),
      };
    }

    // No existing lock - clean up expired and insert new
    await db
      .deleteFrom('presentation_locks')
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .execute();

    const inserted = await db
      .insertInto('presentation_locks')
      .values({
        presentation_id: pid,
        organization_id: orgId,
        holder_user_id: holderId,
        holder_email: holderEmail,
        holder_name: holderName,
        acquired_at: now,
        refreshed_at: now,
        expires_at: expiresAt,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      lock: mapLockRow(inserted),
    };
  });
}

/**
 * Refresh an existing lock (extend TTL).
 * Only the current holder can refresh.
 */
export async function refreshPresentationLock(presentationId, { email, userId } = {}, ctx) {
  const pid = norm(presentationId);
  const holderEmail = norm(email).toLowerCase();
  const actor = { id: userId || null, email: holderEmail };

  if (!pid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();
    const expiresAt = isoAfter(LOCK_TTL_MS);

    // Get existing lock
    const existing = await db
      .selectFrom('presentation_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!existing) {
      return { ok: false, reason: 'missing' };
    }

    // Check if expired
    if (new Date(existing.expires_at) <= new Date(now)) {
      // Clean up expired lock
      await db
        .deleteFrom('presentation_locks')
        .where('presentation_id', '=', pid)
        .where('organization_id', '=', orgId)
        .execute();
      return { ok: false, reason: 'expired' };
    }

    // Check if held by different user (id-primary, e-mail fallback)
    if (!matchesIdentity(actor, holderStamp(existing))) {
      return {
        ok: false,
        reason: 'held',
        lock: mapLockRow(existing),
      };
    }

    // Refresh the lock
    const updated = await db
      .updateTable('presentation_locks')
      .set({
        refreshed_at: now,
        expires_at: expiresAt,
      })
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      lock: mapLockRow(updated),
    };
  });
}

/**
 * Release a lock.
 * Only the current holder can release (except force release).
 */
export async function releasePresentationLock(presentationId, { email, userId } = {}, ctx) {
  const pid = norm(presentationId);
  const holderEmail = norm(email).toLowerCase();
  const actor = { id: userId || null, email: holderEmail };

  if (!pid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Check existing lock
    const existing = await db
      .selectFrom('presentation_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!existing) {
      return { ok: true, released: false };
    }

    // Check if held by different user (id-primary, e-mail fallback)
    if (!matchesIdentity(actor, holderStamp(existing))) {
      return {
        ok: false,
        reason: 'held',
        lock: mapLockRow(existing),
      };
    }

    // Delete the lock
    await db
      .deleteFrom('presentation_locks')
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .execute();

    return { ok: true, released: true };
  });
}

/**
 * Force release a lock (admin/owner use).
 * Releases regardless of who holds it.
 */
export async function forceReleasePresentationLock(presentationId, ctx) {
  const pid = norm(presentationId);
  if (!pid) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .deleteFrom('presentation_locks')
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return { ok: true, released: result.numDeletedRows > 0 };
  });
}

// ============================================================
// LOCK REQUESTS
// ============================================================

/**
 * Create a request for access to a locked presentation.
 */
export async function createLockRequest(presentationId, { email, name, message } = {}, ctx) {
  const pid = norm(presentationId);
  const requesterEmail = norm(email).toLowerCase();
  const requesterName = norm(name) || requesterEmail;

  if (!pid || !requesterEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Check if user already has a pending request
    const existingRequest = await db
      .selectFrom('lock_requests')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('requester_email', '=', requesterEmail)
      .where('status', '=', 'pending')
      .executeTakeFirst();

    if (existingRequest) {
      return {
        ok: false,
        reason: 'already_requested',
        request: mapRequestRow(existingRequest),
      };
    }

    const row = await db
      .insertInto('lock_requests')
      .values({
        presentation_id: pid,
        organization_id: orgId,
        requester_email: requesterEmail,
        requester_name: requesterName,
        message: message || null,
        status: 'pending',
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      request: mapRequestRow(row),
    };
  });
}

/**
 * List pending lock requests for a presentation.
 * Only the current lock holder should call this.
 */
export async function listPendingLockRequests(presentationId, ctx) {
  const pid = norm(presentationId);
  if (!pid) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    const rows = await db
      .selectFrom('lock_requests')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('status', '=', 'pending')
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(mapRequestRow);
  });
}

/**
 * Get a specific lock request by ID.
 */
export async function getLockRequest(requestId, ctx) {
  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('lock_requests')
      .selectAll()
      .where('id', '=', requestId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!row) return null;

    return mapRequestRow(row);
  });
}

/**
 * Accept a lock request - transfers the lock directly to the requester.
 */
export async function acceptLockRequest(requestId, { holderEmail } = {}, ctx) {
  // Get the request first (uses withDbGuard internally)
  const request = await getLockRequest(requestId, ctx);

  if (!request) {
    return { ok: false, reason: 'not_found' };
  }

  if (request.status !== 'pending') {
    return { ok: false, reason: 'already_resolved', status: request.status };
  }

  // Resolve the requester's stable id once: the new holder is the requester,
  // known here only by the e-mail on their lock_requests row (that table has no
  // id column), so unlike acquire/refresh — where the id rides in on the authed
  // session — the transfer resolves it. `external` (no users row) stamps NULL,
  // the same defined absence the e-mail fallback covers.
  const requesterEmail = request.requesterEmail.toLowerCase();
  const holderName = request.requesterName || request.requesterEmail;
  const resolved = await resolveIdentityByEmail(requesterEmail);
  const holderId = resolved?.userId || null;

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();
    const expiresAt = isoAfter(LOCK_TTL_MS);

    // Transfer the lock directly to the requester (instead of just releasing)
    // This prevents the acceptor from re-acquiring on page reload

    const updated = await db
      .updateTable('presentation_locks')
      .set({
        holder_user_id: holderId,
        holder_email: requesterEmail,
        holder_name: holderName,
        acquired_at: now,
        refreshed_at: now,
        expires_at: expiresAt,
      })
      .where('presentation_id', '=', request.presentationId)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    // If there was no lock to update, create one for the requester
    if (!updated) {
      await db
        .insertInto('presentation_locks')
        .values({
          presentation_id: request.presentationId,
          organization_id: orgId,
          holder_user_id: holderId,
          holder_email: requesterEmail,
          holder_name: holderName,
          acquired_at: now,
          refreshed_at: now,
          expires_at: expiresAt,
        })
        .execute();
    }

    // Update request status
    await db
      .updateTable('lock_requests')
      .set({
        status: 'accepted',
        resolved_at: now,
      })
      .where('id', '=', requestId)
      .where('organization_id', '=', orgId)
      .execute();

    return {
      ok: true,
      request: {
        ...request,
        status: 'accepted',
        resolvedAt: now,
      },
    };
  });
}

/**
 * Reject a lock request.
 */
export async function rejectLockRequest(requestId, ctx) {
  // Get the request first (uses withDbGuard internally)
  const request = await getLockRequest(requestId, ctx);
  if (!request) {
    return { ok: false, reason: 'not_found' };
  }

  if (request.status !== 'pending') {
    return { ok: false, reason: 'already_resolved', status: request.status };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    // Update request status
    await db
      .updateTable('lock_requests')
      .set({
        status: 'rejected',
        resolved_at: now,
      })
      .where('id', '=', requestId)
      .where('organization_id', '=', orgId)
      .execute();

    return {
      ok: true,
      request: {
        ...request,
        status: 'rejected',
        resolvedAt: now,
      },
    };
  });
}

/**
 * Get the status of the user's pending request for a presentation.
 * Used by requester to poll for acceptance.
 * Only returns pending requests or recently resolved ones (within 2 minutes).
 * Returns null if the user already holds the lock (they don't need their request status).
 */
export async function getUserLockRequestStatus(presentationId, { email, userId } = {}, ctx) {
  const pid = norm(presentationId);
  const userEmail = norm(email).toLowerCase();
  if (!pid || !userEmail) return null;

  // If the user already holds the lock, they don't need their request status
  // (this prevents old "accepted" requests from triggering re-acquire). The
  // holder check is id-primary; the requester lookup below stays keyed on the
  // e-mail because lock_requests carries no requester id column.
  const currentLock = await getPresentationLock(pid, ctx);
  if (currentLock && matchesIdentity({ id: userId || null, email: userEmail }, { userId: currentLock.holderId, email: currentLock.holderEmail })) {
    return null;
  }

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    // Get the most recent request from this user
    const row = await db
      .selectFrom('lock_requests')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('requester_email', '=', userEmail)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    // Only return pending requests or recently resolved ones (within 2 minutes)
    // This prevents old accepted/rejected requests from triggering actions
    if (row && row.status !== 'pending' && row.resolved_at) {
      const resolvedAt = new Date(row.resolved_at).getTime();
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
      if (resolvedAt < twoMinutesAgo) {
        return null;
      }
    }

    if (!row) return null;

    return mapRequestRow(row);
  });
}
