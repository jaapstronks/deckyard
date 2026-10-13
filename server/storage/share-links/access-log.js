/**
 * Access logging for share links.
 *
 * Public writes follow a validated share token and use a reasoned instance
 * scope. Management reads require the authorized organization's scope and
 * filter through the parent link before returning viewer PII.
 */

import { norm } from '../../utils/normalize.js';
import { toStorageContext } from '../scope.js';
import { withDbGuard } from '../../db/client.js';

/**
 * Log access to a share link.
 * @param {object} scope - Authorized organization or share-token scope
 * @param {string} shareLinkId - The share link ID
 * @param {Object} [info] - Access info
 * @param {string} [info.ipAddress] - Client IP
 * @param {string} [info.userAgent] - Client user agent
 * @returns {Promise<void>}
 */
export async function logShareLinkAccess(scope, shareLinkId, info) {
  const context = toStorageContext(
    scope,
    'logShareLinkAccess',
    {},
    { allowCrossOrganization: true },
  );
  const id = norm(shareLinkId);
  if (!id) return;

  return withDbGuard(undefined, async (db) => {
    let link = db
      .selectFrom('presentation_share_links')
      .select('id')
      .where('id', '=', id);
    if (context.organizationId)
      link = link.where('organization_id', '=', context.organizationId);
    if (!(await link.executeTakeFirst())) return;
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
 * @param {object} scope - Authorized organization scope
 * @param {string} shareLinkId - The share link ID
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Max records to return
 * @param {number} [options.offset] - Records to skip
 * @returns {Promise<Array>} - Access log entries
 */
export async function getShareLinkAccessLog(scope, shareLinkId, options) {
  const { organizationId } = toStorageContext(scope, 'getShareLinkAccessLog');
  const id = norm(shareLinkId);
  if (!id) return [];

  return withDbGuard([], async (db) => {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const rows = await db
      .selectFrom('share_link_access_log')
      .innerJoin(
        'presentation_share_links',
        'presentation_share_links.id',
        'share_link_access_log.share_link_id',
      )
      .selectAll('share_link_access_log')
      .where('share_link_access_log.share_link_id', '=', id)
      .where('presentation_share_links.organization_id', '=', organizationId)
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
