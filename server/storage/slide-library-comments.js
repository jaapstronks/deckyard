/**
 * Library-item thread storage (B906, D369): the messages on one shared
 * library item, oldest first. See migration 107 for why this is a table of its
 * own rather than a target on `presentation_comments`.
 *
 * Every read and write is scoped to the caller's organization and to the item
 * the route names, so a message id from another item or organization answers
 * as absent. Whether the reader may see the item at all is the service's
 * question (`server/services/library-item-comments.js`); this layer only
 * stores.
 *
 * A message names its author as a display pair (D22); the address stays here,
 * except for {@link listLibraryThreadRecipients}, which the notification path
 * reads.
 */

import { getDb } from '../db/client.js';
import { getOrgId } from '../utils/context.js';
import { normalizeEmail } from '../../shared/email.js';
import { isUuid } from '../utils/uuid.js';
import { toStorageContext } from './scope.js';
import { resolveDisplayNames, toAuthorIdentity } from './display-identity.js';

/**
 * @typedef {Object} LibraryThreadMessage
 * @property {string} id
 * @property {string} itemId
 * @property {import('./display-identity.js').DisplayIdentity|null} author
 * @property {string} body
 * @property {string} createdAt
 */

/**
 * Map rows to messages, with the author names resolved in one batch.
 * @param {object[]} rows
 * @param {object} ctx - Storage context
 * @returns {Promise<LibraryThreadMessage[]>}
 */
async function toMessages(rows, ctx) {
  const lookup = await resolveDisplayNames(
    ctx,
    rows.map((row) => ({ id: row.author_user_id, email: row.author_email })),
  );
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    author: toAuthorIdentity(
      row.author_user_id,
      row.author_email,
      row.author_name,
      lookup,
    ),
    body: row.body,
    createdAt: row.created_at,
  }));
}

/**
 * The thread on one item, oldest first.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} itemId
 * @returns {Promise<LibraryThreadMessage[]>}
 */
export async function listLibraryThread(scope, itemId) {
  const ctx = toStorageContext(scope, 'listLibraryThread');
  if (!isUuid(itemId)) return [];
  const rows = await getDb()
    .selectFrom('slide_library_comments')
    .selectAll()
    .where('organization_id', '=', getOrgId(ctx))
    .where('item_id', '=', itemId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return toMessages(rows, ctx);
}

/**
 * Add a message to an item's thread.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} itemId
 * @param {{authorUserId?: string|null, authorEmail: string, authorName?: string|null, body: string}} data
 * @returns {Promise<LibraryThreadMessage>}
 */
export async function createLibraryThreadMessage(scope, itemId, data) {
  const ctx = toStorageContext(scope, 'createLibraryThreadMessage');
  const row = await getDb()
    .insertInto('slide_library_comments')
    .values({
      organization_id: getOrgId(ctx),
      item_id: itemId,
      author_user_id: data.authorUserId || null,
      author_email: normalizeEmail(data.authorEmail),
      author_name: data.authorName || null,
      body: data.body,
    })
    .returningAll()
    .executeTakeFirst();
  const [message] = await toMessages([row], ctx);
  return message;
}

/**
 * One message of an item's thread, with the author key the delete check
 * compares; null when it is not on that item.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} itemId
 * @param {string} messageId
 * @returns {Promise<{id: string, authorUserId: string|null}|null>}
 */
export async function getLibraryThreadMessage(scope, itemId, messageId) {
  const ctx = toStorageContext(scope, 'getLibraryThreadMessage');
  if (!isUuid(itemId) || !isUuid(messageId)) return null;
  const row = await getDb()
    .selectFrom('slide_library_comments')
    .select(['id', 'author_user_id'])
    .where('organization_id', '=', getOrgId(ctx))
    .where('item_id', '=', itemId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  return row ? { id: row.id, authorUserId: row.author_user_id || null } : null;
}

/**
 * Delete one message of an item's thread.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} itemId
 * @param {string} messageId
 * @returns {Promise<boolean>} whether a message was deleted
 */
export async function deleteLibraryThreadMessage(scope, itemId, messageId) {
  const ctx = toStorageContext(scope, 'deleteLibraryThreadMessage');
  if (!isUuid(itemId) || !isUuid(messageId)) return false;
  const rows = await getDb()
    .deleteFrom('slide_library_comments')
    .where('organization_id', '=', getOrgId(ctx))
    .where('item_id', '=', itemId)
    .where('id', '=', messageId)
    .returning('id')
    .execute();
  return rows.length > 0;
}

/**
 * Who hears about a new message on an item: its maker (the current address
 * of `created_by_user_id`, else the stored `created_by`) and everyone who
 * wrote in the thread before. Normalized and unique; the caller drops the
 * actor.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} itemId
 * @returns {Promise<string[]>}
 */
export async function listLibraryThreadRecipients(scope, itemId) {
  const ctx = toStorageContext(scope, 'listLibraryThreadRecipients');
  if (!isUuid(itemId)) return [];
  const orgId = getOrgId(ctx);
  const db = getDb();
  const maker = await db
    .selectFrom('slide_library as l')
    .leftJoin('users as u', 'u.id', 'l.created_by_user_id')
    .select(['u.email as user_email', 'l.created_by'])
    .where('l.organization_id', '=', orgId)
    .where('l.id', '=', itemId)
    .executeTakeFirst();
  const writers = await db
    .selectFrom('slide_library_comments')
    .select('author_email')
    .distinct()
    .where('organization_id', '=', orgId)
    .where('item_id', '=', itemId)
    .execute();
  const emails = [
    maker?.user_email || maker?.created_by,
    ...writers.map((w) => w.author_email),
  ]
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
  return [...new Set(emails)];
}
