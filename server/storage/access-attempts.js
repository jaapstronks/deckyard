/**
 * Storage layer for revoked-link access attempts.
 *
 * A row here means one thing: the deck author was notified of an attempt to
 * open revoked content. It exists to deduplicate that notification per
 * accessor, and for nothing else (B785): the only reader is
 * `shouldNotifyAuthor`, which looks back {@link ACCESS_ATTEMPT_WINDOW_MS}, so
 * an attempt that produced no notification is never written, and the
 * retention job deletes every row once it leaves the window. The accessor's
 * IP is the identity the deduplication matches on when no e-mail is known;
 * it is kept for the window and no longer.
 */

import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { norm, nowIso } from '../utils/normalize.js';
import { normalizeEmail } from '../../shared/email.js';
import { withDbGuard } from '../db/client.js';

/**
 * Access types for logging.
 */
export const ACCESS_TYPES = {
  SHARE_LINK: 'share_link',
  COLLABORATOR: 'collaborator',
  TRASHED: 'trashed',
};

/**
 * The one window an attempt record lives in: the author is notified at most
 * once per accessor per window, and a row older than the window has no
 * reader left, so the retention job removes it. Functional, not configurable.
 */
export const ACCESS_ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Record that the author was notified of an access attempt. The row is the
 * deduplication record for {@link shouldNotifyAuthor}: it is written only
 * once the notification is due, and `author_notified_at` is set in the same
 * insert, so there is no unnotified attempt row.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} data - Access attempt data
 * @param {string} data.presentationId - Presentation ID
 * @param {string} data.accessType - Type of access (share_link, collaborator, trashed)
 * @param {string} [data.accessReferenceId] - Reference ID (e.g., share link ID)
 * @param {string} [data.accessorEmail] - Accessor's email (if logged in)
 * @param {string} [data.accessorIp] - Accessor's IP address
 * @returns {Promise<Object>} - Result
 */
export async function logAccessAttempt(scope, data) {
  toStorageContext(scope, 'logAccessAttempt');
  const presentationId = norm(data?.presentationId);
  if (!presentationId) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const row = await db
      .insertInto('access_attempt_log')
      .values({
        organization_id: orgId,
        presentation_id: presentationId,
        access_type: data.accessType || ACCESS_TYPES.SHARE_LINK,
        access_reference_id: data.accessReferenceId || null,
        accessor_email: normalizeEmail(data.accessorEmail) || null,
        accessor_ip: data.accessorIp || null,
        attempted_at: now,
        author_notified_at: now,
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
 * Check if author should be notified (rate limit: 1 per accessor per window).
 *
 * Every row is a notified attempt (`author_notified_at` is set in the insert
 * since B785), so a record inside the window deduplicates on its own; the
 * column is a timestamp, not a filter (B786).
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId - Presentation ID
 * @param {string} [accessorEmail] - Accessor's email
 * @param {string} [accessorIp] - Accessor's IP (used if no email)
 * @returns {Promise<boolean>} - True if should notify
 */
export async function shouldNotifyAuthor(
  scope,
  presentationId,
  accessorEmail,
  accessorIp,
) {
  toStorageContext(scope, 'shouldNotifyAuthor');
  const pid = norm(presentationId);
  if (!pid) return false;

  const email = normalizeEmail(accessorEmail);

  return withDbGuard(false, async (db) => {
    const orgId = getOrgId(scope);
    const windowStart = new Date(
      Date.now() - ACCESS_ATTEMPT_WINDOW_MS,
    ).toISOString();

    let query = db
      .selectFrom('access_attempt_log')
      .select('id')
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('attempted_at', '>', windowStart);

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
 * Delete access attempt records older than the window (retention job).
 *
 * Instance-wide: a scheduled retention job has no organization context, so
 * this deletes across every organization, the same model as
 * `deleteOldActivityEvents`. Only an instance retention scope is accepted
 * (storage-scope.md category 7).
 * @param {import('./scope.js').StorageScope} scope - Reasoned instance retention scope
 * @param {string} olderThan - ISO timestamp; attempts before it are removed
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteOldAccessAttempts(scope, olderThan) {
  const context = toStorageContext(
    scope,
    'deleteOldAccessAttempts',
    {},
    { allowCrossOrganization: true },
  );
  if (context.organizationId || !context.crossOrganization)
    throw new TypeError(
      'deleteOldAccessAttempts() requires an instance retention scope',
    );
  return withDbGuard({ deleted: 0 }, async (db) => {
    const result = await db
      .deleteFrom('access_attempt_log')
      .where('attempted_at', '<', olderThan)
      .executeTakeFirst();

    return { deleted: Number(result.numDeletedRows) || 0 };
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
