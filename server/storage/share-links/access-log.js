/**
 * Access logging for share links.
 */

import { norm } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';

/**
 * Log access to a share link.
 * @param {string} shareLinkId - The share link ID
 * @param {Object} [info] - Access info
 * @param {string} [info.ipAddress] - Client IP
 * @param {string} [info.userAgent] - Client user agent
 * @param {Object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function logShareLinkAccess(shareLinkId, info, ctx) {
  const id = norm(shareLinkId);
  if (!id) return;

  return withDbGuard(undefined, async (db) => {
    await db
      .insertInto('share_link_access_log')
      .values({
        share_link_id: id,
        ip_address: info?.ipAddress || null,
        user_agent: info?.userAgent || null,
      })
      .execute();
  });
}

/**
 * Get access log for a share link.
 * @param {string} shareLinkId - The share link ID
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Max records to return
 * @param {number} [options.offset] - Records to skip
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - Access log entries
 */
export async function getShareLinkAccessLog(shareLinkId, options, ctx) {
  const id = norm(shareLinkId);
  if (!id) return [];

  return withDbGuard([], async (db) => {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const rows = await db
      .selectFrom('share_link_access_log')
      .selectAll()
      .where('share_link_id', '=', id)
      .orderBy('accessed_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      shareLinkId: row.share_link_id,
      accessedAt: row.accessed_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    }));
  });
}