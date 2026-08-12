/**
 * Database-backed slide locks for concurrent editing.
 * Allows multiple users to edit different slides in the same presentation.
 *
 * Unlike presentation locks which lock the entire deck, slide locks
 * only lock individual slides, enabling true concurrent collaboration.
 */

import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { norm, nowIso, isoAfter } from '../utils/normalize.js';
import { matchesIdentity } from '../../shared/identity-match.js';
import { withDbGuard } from './utils/db-guard.js';

const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ============================================================
// ROW MAPPERS - Convert database rows to API objects
// ============================================================

/**
 * Map a slide_locks row to a lock object.
 * @param {Object} row - Database row from slide_locks table
 * @returns {Object} Lock object for API response
 */
function mapLockRow(row) {
  return {
    presentationId: row.presentation_id,
    slideId: row.slide_id,
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
 * @param {Object} row - A slide_locks row
 * @returns {{userId: string|null, email: string}}
 */
function holderStamp(row) {
  return { userId: row.holder_user_id || null, email: row.holder_email };
}

// ============================================================
// SLIDE LOCKS
// ============================================================

/**
 * Get all active locks for a presentation.
 * Returns a map of slideId -> lock info.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId - The presentation ID
 * @returns {Promise<Object>} Map of slideId to lock info
 */
export async function getSlideLocks(scope, presentationId) {
  toStorageContext(scope, 'getSlideLocks');
  const pid = norm(presentationId);
  if (!pid) return {};

  return withDbGuard({}, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const rows = await db
      .selectFrom('slide_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('expires_at', '>', now)
      .execute();

    const locks = {};
    for (const row of rows) {
      locks[row.slide_id] = mapLockRow(row);
    }
    return locks;
  });
}

/**
 * Get a single slide lock.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId - The presentation ID
 * @param {string} slideId - The slide ID
 * @returns {Promise<Object|null>} Lock info or null
 */
export async function getSlideLock(scope, presentationId, slideId) {
  toStorageContext(scope, 'getSlideLock');
  const pid = norm(presentationId);
  const sid = norm(slideId);
  if (!pid || !sid) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const row = await db
      .selectFrom('slide_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('slide_id', '=', sid)
      .where('organization_id', '=', orgId)
      .where('expires_at', '>', now)
      .executeTakeFirst();

    if (!row) return null;
    return mapLockRow(row);
  });
}

/**
 * Acquire a lock for editing a slide.
 * If the same user already holds the lock, refreshes it.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId - The presentation ID
 * @param {string} slideId - The slide ID
 * @param {Object} user - User info { email, name }
 * @returns {Promise<Object>} { ok: boolean, reason?, lock? }
 */
export async function acquireSlideLock(scope, presentationId, slideId, { email, name, userId } = {}) {
  toStorageContext(scope, 'acquireSlideLock');
  const pid = norm(presentationId);
  const sid = norm(slideId);
  const holderEmail = norm(email).toLowerCase();
  const holderName = norm(name) || holderEmail;
  const holderId = userId || null;

  if (!pid || !sid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();
    const expiresAt = isoAfter(LOCK_TTL_MS);

    // One atomic upsert replaces the old check-then-delete-then-insert, which
    // raced two concurrent acquires into a unique-constraint 500: both passed
    // the "no existing lock" SELECT, both deleted nothing, and the second INSERT
    // violated slide_locks_presentation_id_slide_id_key.
    //
    // The conflict target is the *real* unique constraint — (presentation_id,
    // slide_id), WITHOUT organization_id (migration 023). The DO UPDATE only
    // fires when the current lock is expired or already held by this user, so a
    // live lock held by someone else survives untouched and is reported as
    // { ok: false, reason: 'held' } below.
    //
    // acquired_at is reset to `now` on every successful acquire, including a
    // same-user refresh. Nothing reads a slide lock's acquiredAt today, so the
    // plain upsert is preferred over a CASE that would preserve the original.
    const inserted = await db
      .insertInto('slide_locks')
      .values({
        presentation_id: pid,
        slide_id: sid,
        organization_id: orgId,
        holder_user_id: holderId,
        holder_email: holderEmail,
        holder_name: holderName,
        acquired_at: now,
        refreshed_at: now,
        expires_at: expiresAt,
      })
      .onConflict((oc) =>
        oc
          .columns(['presentation_id', 'slide_id'])
          .doUpdateSet({
            holder_user_id: holderId,
            holder_email: holderEmail,
            holder_name: holderName,
            acquired_at: now,
            refreshed_at: now,
            expires_at: expiresAt,
          })
          .where((eb) => {
            // The DO UPDATE only fires when the lock is expired or already this
            // user's. Matching by id too means a holder who renamed still
            // re-acquires their own live lock (the e-mail no longer equals the
            // stored one, but the stable id does) — the rename-robustness F3 buys.
            const mine = [eb('slide_locks.holder_email', '=', holderEmail)];
            if (holderId) mine.push(eb('slide_locks.holder_user_id', '=', holderId));
            return eb.or([eb('slide_locks.expires_at', '<=', now), ...mine]);
          })
      )
      .returningAll()
      .executeTakeFirst();

    if (inserted) {
      return { ok: true, lock: mapLockRow(inserted) };
    }

    // No row returned: the DO UPDATE guard was false, i.e. a live lock held by
    // someone else. Report the current holder.
    const held = await db
      .selectFrom('slide_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('slide_id', '=', sid)
      .where('organization_id', '=', orgId)
      .where('expires_at', '>', now)
      .executeTakeFirst();

    return {
      ok: false,
      reason: 'held',
      lock: held ? mapLockRow(held) : undefined,
    };
  });
}

/**
 * Refresh an existing slide lock (extend TTL).
 * Only the current holder can refresh.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId - The presentation ID
 * @param {string} slideId - The slide ID
 * @param {Object} user - User info { email }
 * @returns {Promise<Object>} { ok: boolean, reason?, lock? }
 */
export async function refreshSlideLock(scope, presentationId, slideId, { email, userId } = {}) {
  toStorageContext(scope, 'refreshSlideLock');
  const pid = norm(presentationId);
  const sid = norm(slideId);
  const holderEmail = norm(email).toLowerCase();
  const actor = { id: userId || null, email: holderEmail };

  if (!pid || !sid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();
    const expiresAt = isoAfter(LOCK_TTL_MS);

    // Get existing lock
    const existing = await db
      .selectFrom('slide_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('slide_id', '=', sid)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!existing) {
      return { ok: false, reason: 'missing' };
    }

    // Check if expired
    if (new Date(existing.expires_at) <= new Date(now)) {
      // Clean up expired lock
      await db
        .deleteFrom('slide_locks')
        .where('presentation_id', '=', pid)
        .where('slide_id', '=', sid)
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
      .updateTable('slide_locks')
      .set({
        refreshed_at: now,
        expires_at: expiresAt,
      })
      .where('presentation_id', '=', pid)
      .where('slide_id', '=', sid)
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
 * Release a slide lock.
 * Only the current holder can release.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId - The presentation ID
 * @param {string} slideId - The slide ID
 * @param {Object} user - User info { email }
 * @returns {Promise<Object>} { ok: boolean, reason?, released? }
 */
export async function releaseSlideLock(scope, presentationId, slideId, { email, userId } = {}) {
  toStorageContext(scope, 'releaseSlideLock');
  const pid = norm(presentationId);
  const sid = norm(slideId);
  const holderEmail = norm(email).toLowerCase();
  const actor = { id: userId || null, email: holderEmail };

  if (!pid || !sid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    // Check existing lock
    const existing = await db
      .selectFrom('slide_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('slide_id', '=', sid)
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
      .deleteFrom('slide_locks')
      .where('presentation_id', '=', pid)
      .where('slide_id', '=', sid)
      .where('organization_id', '=', orgId)
      .execute();

    return { ok: true, released: true };
  });
}

/**
 * Release all slide locks held by a user in a presentation.
 * Used when user navigates away or disconnects.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId - The presentation ID
 * @param {Object} user - User info { email }
 * @returns {Promise<Object>} { ok: boolean, releasedCount: number }
 */
export async function releaseAllUserSlideLocks(scope, presentationId, { email, userId } = {}) {
  toStorageContext(scope, 'releaseAllUserSlideLocks');
  const pid = norm(presentationId);
  const holderEmail = norm(email).toLowerCase();
  const holderId = userId || null;

  if (!pid || !holderEmail) {
    return { ok: false, reason: 'invalid', releasedCount: 0 };
  }

  return withDbGuard({ ok: false, reason: 'unavailable', releasedCount: 0 }, async (db) => {
    const orgId = getOrgId(scope);

    const result = await db
      .deleteFrom('slide_locks')
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      // Match the caller's own locks by id or e-mail: a holder who renamed
      // mid-session still tears down the locks they took under the old address.
      .where((eb) => {
        const mine = [eb('holder_email', '=', holderEmail)];
        if (holderId) mine.push(eb('holder_user_id', '=', holderId));
        return eb.or(mine);
      })
      .executeTakeFirst();

    return {
      ok: true,
      releasedCount: Number(result.numDeletedRows) || 0,
    };
  });
}

/**
 * Release all slide locks held by a user across all presentations.
 * Used for global cleanup on disconnect.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} user - User info { email }
 * @returns {Promise<Object>} { ok: boolean, releasedCount: number }
 */
export async function releaseAllUserLocksGlobally(scope, { email, userId } = {}) {
  toStorageContext(scope, 'releaseAllUserLocksGlobally');
  const holderEmail = norm(email).toLowerCase();
  const holderId = userId || null;

  if (!holderEmail) {
    return { ok: false, reason: 'invalid', releasedCount: 0 };
  }

  return withDbGuard({ ok: false, reason: 'unavailable', releasedCount: 0 }, async (db) => {
    const orgId = getOrgId(scope);

    const result = await db
      .deleteFrom('slide_locks')
      .where('organization_id', '=', orgId)
      .where((eb) => {
        const mine = [eb('holder_email', '=', holderEmail)];
        if (holderId) mine.push(eb('holder_user_id', '=', holderId));
        return eb.or(mine);
      })
      .executeTakeFirst();

    return {
      ok: true,
      releasedCount: Number(result.numDeletedRows) || 0,
    };
  });
}

/**
 * Cleanup all expired slide locks (background task).
 *
 * Instance-wide on purpose: a scheduled job has no org context, and an expired
 * lock is expired in every organization.
 * @returns {Promise<number>} Number of locks cleaned up
 */
export async function cleanupExpiredSlideLocks() {
  return withDbGuard(0, async (db) => {
    const now = nowIso();

    const result = await db
      .deleteFrom('slide_locks')
      .where('expires_at', '<=', now)
      .executeTakeFirst();

    return Number(result.numDeletedRows) || 0;
  });
}

/**
 * Get list of slides locked by others for a given presentation/user.
 * Useful for UI to show which slides are unavailable.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId - The presentation ID
 * @param {Object} user - User info { email }
 * @returns {Promise<Array>} Array of lock objects for slides locked by others
 */
export async function getLockedByOthers(scope, presentationId, { email, userId } = {}) {
  toStorageContext(scope, 'getLockedByOthers');
  const pid = norm(presentationId);
  const actor = { id: userId || null, email: norm(email).toLowerCase() };
  if (!pid) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const rows = await db
      .selectFrom('slide_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('expires_at', '>', now)
      .execute();

    // Exclude the caller's own locks by identity, not by a raw e-mail match:
    // a holder who renamed still owns a lock stamped with their old address, so
    // an e-mail-only filter would wrongly report it as held by someone else.
    return rows.filter((row) => !matchesIdentity(actor, holderStamp(row))).map(mapLockRow);
  });
}
