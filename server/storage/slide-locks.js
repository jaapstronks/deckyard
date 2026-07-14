/**
 * Database-backed slide locks for concurrent editing.
 * Allows multiple users to edit different slides in the same presentation.
 *
 * Unlike presentation locks which lock the entire deck, slide locks
 * only lock individual slides, enabling true concurrent collaboration.
 */

import { getOrgId } from '../utils/context.js';
import { norm, nowIso, isoAfter } from '../utils/normalize.js';
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
    holderEmail: row.holder_email,
    holderName: row.holder_name,
    acquiredAt: row.acquired_at,
    refreshedAt: row.refreshed_at,
    expiresAt: row.expires_at,
  };
}

// ============================================================
// SLIDE LOCKS
// ============================================================

/**
 * Get all active locks for a presentation.
 * Returns a map of slideId -> lock info.
 * @param {string} presentationId - The presentation ID
 * @param {Object} ctx - Context with organization info
 * @returns {Promise<Object>} Map of slideId to lock info
 */
export async function getSlideLocks(presentationId, ctx) {
  const pid = norm(presentationId);
  if (!pid) return {};

  return withDbGuard({}, async (db) => {
    const orgId = getOrgId(ctx);
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
 * @param {string} presentationId - The presentation ID
 * @param {string} slideId - The slide ID
 * @param {Object} ctx - Context with organization info
 * @returns {Promise<Object|null>} Lock info or null
 */
export async function getSlideLock(presentationId, slideId, ctx) {
  const pid = norm(presentationId);
  const sid = norm(slideId);
  if (!pid || !sid) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);
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
 * @param {string} presentationId - The presentation ID
 * @param {string} slideId - The slide ID
 * @param {Object} user - User info { email, name }
 * @param {Object} ctx - Context with organization info
 * @returns {Promise<Object>} { ok: boolean, reason?, lock? }
 */
export async function acquireSlideLock(presentationId, slideId, { email, name } = {}, ctx) {
  const pid = norm(presentationId);
  const sid = norm(slideId);
  const holderEmail = norm(email).toLowerCase();
  const holderName = norm(name) || holderEmail;

  if (!pid || !sid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();
    const expiresAt = isoAfter(LOCK_TTL_MS);

    // Check for existing non-expired lock
    const existing = await db
      .selectFrom('slide_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('slide_id', '=', sid)
      .where('organization_id', '=', orgId)
      .where('expires_at', '>', now)
      .executeTakeFirst();

    if (existing) {
      // If held by someone else, return error
      if (existing.holder_email !== holderEmail) {
        return {
          ok: false,
          reason: 'held',
          lock: mapLockRow(existing),
        };
      }

      // Same user - refresh the lock
      const updated = await db
        .updateTable('slide_locks')
        .set({
          holder_name: holderName,
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
    }

    // No existing lock - clean up expired and insert new
    await db
      .deleteFrom('slide_locks')
      .where('presentation_id', '=', pid)
      .where('slide_id', '=', sid)
      .where('organization_id', '=', orgId)
      .execute();

    const inserted = await db
      .insertInto('slide_locks')
      .values({
        presentation_id: pid,
        slide_id: sid,
        organization_id: orgId,
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
 * Refresh an existing slide lock (extend TTL).
 * Only the current holder can refresh.
 * @param {string} presentationId - The presentation ID
 * @param {string} slideId - The slide ID
 * @param {Object} user - User info { email }
 * @param {Object} ctx - Context with organization info
 * @returns {Promise<Object>} { ok: boolean, reason?, lock? }
 */
export async function refreshSlideLock(presentationId, slideId, { email } = {}, ctx) {
  const pid = norm(presentationId);
  const sid = norm(slideId);
  const holderEmail = norm(email).toLowerCase();

  if (!pid || !sid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
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

    // Check if held by different user
    if (existing.holder_email !== holderEmail) {
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
 * @param {string} presentationId - The presentation ID
 * @param {string} slideId - The slide ID
 * @param {Object} user - User info { email }
 * @param {Object} ctx - Context with organization info
 * @returns {Promise<Object>} { ok: boolean, reason?, released? }
 */
export async function releaseSlideLock(presentationId, slideId, { email } = {}, ctx) {
  const pid = norm(presentationId);
  const sid = norm(slideId);
  const holderEmail = norm(email).toLowerCase();

  if (!pid || !sid || !holderEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

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

    // Check if held by different user
    if (existing.holder_email !== holderEmail) {
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
 * @param {string} presentationId - The presentation ID
 * @param {Object} user - User info { email }
 * @param {Object} ctx - Context with organization info
 * @returns {Promise<Object>} { ok: boolean, releasedCount: number }
 */
export async function releaseAllUserSlideLocks(presentationId, { email } = {}, ctx) {
  const pid = norm(presentationId);
  const holderEmail = norm(email).toLowerCase();

  if (!pid || !holderEmail) {
    return { ok: false, reason: 'invalid', releasedCount: 0 };
  }

  return withDbGuard({ ok: false, reason: 'unavailable', releasedCount: 0 }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .deleteFrom('slide_locks')
      .where('presentation_id', '=', pid)
      .where('holder_email', '=', holderEmail)
      .where('organization_id', '=', orgId)
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
 * @param {Object} user - User info { email }
 * @param {Object} ctx - Context with organization info
 * @returns {Promise<Object>} { ok: boolean, releasedCount: number }
 */
export async function releaseAllUserLocksGlobally({ email } = {}, ctx) {
  const holderEmail = norm(email).toLowerCase();

  if (!holderEmail) {
    return { ok: false, reason: 'invalid', releasedCount: 0 };
  }

  return withDbGuard({ ok: false, reason: 'unavailable', releasedCount: 0 }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .deleteFrom('slide_locks')
      .where('holder_email', '=', holderEmail)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return {
      ok: true,
      releasedCount: Number(result.numDeletedRows) || 0,
    };
  });
}

/**
 * Cleanup all expired slide locks (background task).
 * @param {Object} ctx - Context with organization info
 * @returns {Promise<number>} Number of locks cleaned up
 */
export async function cleanupExpiredSlideLocks(ctx) {
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
 * @param {string} presentationId - The presentation ID
 * @param {Object} user - User info { email }
 * @param {Object} ctx - Context with organization info
 * @returns {Promise<Array>} Array of lock objects for slides locked by others
 */
export async function getLockedByOthers(presentationId, { email } = {}, ctx) {
  const pid = norm(presentationId);
  const userEmail = norm(email).toLowerCase();
  if (!pid) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    const rows = await db
      .selectFrom('slide_locks')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('expires_at', '>', now)
      .where('holder_email', '!=', userEmail)
      .execute();

    return rows.map(mapLockRow);
  });
}