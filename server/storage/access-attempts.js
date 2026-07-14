/**
 * Storage layer for access attempt logging.
 * Tracks attempts to access revoked content for author notifications.
 */

import { getOrgId } from '../utils/context.js';
import { norm, nowIso, normalizeEmail } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';

/**
 * Access types for logging.
 */
export const ACCESS_TYPES = {
  SHARE_LINK: 'share_link',
  COLLABORATOR: 'collaborator',
  TRASHED: 'trashed',
};

/**
 * Log an access attempt.
 * @param {Object} data - Access attempt data
 * @param {string} data.presentationId - Presentation ID
 * @param {string} data.accessType - Type of access (share_link, collaborator, trashed)
 * @param {string} [data.accessReferenceId] - Reference ID (e.g., share link ID)
 * @param {string} [data.accessorEmail] - Accessor's email (if logged in)
 * @param {string} [data.accessorIp] - Accessor's IP address
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function logAccessAttempt(data, ctx) {
  const presentationId = norm(data?.presentationId);
  if (!presentationId) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .insertInto('access_attempt_log')
      .values({
        organization_id: orgId,
        presentation_id: presentationId,
        access_type: data.accessType || ACCESS_TYPES.SHARE_LINK,
        access_reference_id: data.accessReferenceId || null,
        accessor_email: normalizeEmail(data.accessorEmail) || null,
        accessor_ip: data.accessorIp || null,
        attempted_at: nowIso(),
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      attempt: formatAccessAttempt(row),
    };
  });
}

/**
 * Check if author should be notified (rate limit: 1 per accessor per 24h).
 * @param {string} presentationId - Presentation ID
 * @param {string} [accessorEmail] - Accessor's email
 * @param {string} [accessorIp] - Accessor's IP (used if no email)
 * @param {Object} ctx - Context object
 * @returns {Promise<boolean>} - True if should notify
 */
export async function shouldNotifyAuthor(presentationId, accessorEmail, accessorIp, ctx) {
  const pid = norm(presentationId);
  if (!pid) return false;

  const email = normalizeEmail(accessorEmail);

  return withDbGuard(false, async (db) => {
    const orgId = getOrgId(ctx);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let query = db
      .selectFrom('access_attempt_log')
      .select('id')
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('author_notified_at', 'is not', null)
      .where('attempted_at', '>', twentyFourHoursAgo);

    // Match by email if available, otherwise by IP
    if (email) {
      query = query.where('accessor_email', '=', email);
    } else if (accessorIp) {
      query = query
        .where('accessor_email', 'is', null)
        .where('accessor_ip', '=', accessorIp);
    } else {
      // No identifier, always allow notification
      return true;
    }

    const recent = await query.executeTakeFirst();
    return !recent;
  });
}

/**
 * Mark an access attempt as having notified the author.
 * @param {string} attemptId - Access attempt ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function markAuthorNotified(attemptId, ctx) {
  const id = norm(attemptId);
  if (!id) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    await db
      .updateTable('access_attempt_log')
      .set({ author_notified_at: nowIso() })
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .execute();

    return { ok: true };
  });
}

/**
 * List recent access attempts for a presentation.
 * @param {string} presentationId - Presentation ID
 * @param {Object} options - Options
 * @param {number} [options.limit=50] - Max results
 * @param {number} [options.offset=0] - Offset
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - List of access attempts
 */
export async function listAccessAttempts(presentationId, options = {}, ctx) {
  const pid = norm(presentationId);
  if (!pid) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);
    const limit = Math.min(Math.max(1, options.limit || 50), 100);
    const offset = Math.max(0, options.offset || 0);

    const rows = await db
      .selectFrom('access_attempt_log')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .orderBy('attempted_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map(formatAccessAttempt);
  });
}

/**
 * Format a database row into an access attempt object.
 * @param {Object} row - Database row
 * @returns {Object} - Formatted access attempt
 */
function formatAccessAttempt(row) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    accessType: row.access_type,
    accessReferenceId: row.access_reference_id,
    accessorEmail: row.accessor_email,
    accessorIp: row.accessor_ip,
    attemptedAt: row.attempted_at,
    authorNotifiedAt: row.author_notified_at,
  };
}
