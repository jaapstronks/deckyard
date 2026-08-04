/**
 * Access logging for share links.
 *
 * **The share link is the scope; these functions take no context.** A
 * `presentation_share_links.id` is a globally unique uuid and every row here
 * hangs off exactly one of them, so the link identifies the workspace by
 * itself — an organization in the filter cannot narrow the answer, only get it
 * wrong. Same reasoning as the collaborator lookups (see
 * `docs/reference/tenant-isolation.md`, edge decision 5) and the share-link
 * token paths: the identifier *is* the addressing.
 *
 * That puts authorization on the caller, where it already lives: the
 * management route authorizes the presentation (`withPresentationAuth`) and
 * then binds the link id to it (`loadLinkForPresentation`, which reads through
 * the org-filtered `getShareLinkById`) before it reads viewer PII. Do not add
 * a context parameter back — pass a link id you have authorized.
 */

import { norm } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';

/**
 * Log access to a share link.
 * @param {string} shareLinkId - The share link ID
 * @param {Object} [info] - Access info
 * @param {string} [info.ipAddress] - Client IP
 * @param {string} [info.userAgent] - Client user agent
 * @returns {Promise<void>}
 */
export async function logShareLinkAccess(shareLinkId, info) {
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
 * @returns {Promise<Array>} - Access log entries
 */
export async function getShareLinkAccessLog(shareLinkId, options) {
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