/**
 * Who may change a slide-library item (D170): the one predicate behind the
 * library's own write routes and the `canEdit` every reader of an item gets,
 * so no client derives it.
 */

import { matchesIdentity } from '../../shared/identity-match.js';
import { sharingEnabled } from '../config/sandbox.js';

/**
 * May this user change this shared item: its name, description or content,
 * trashing it, and deleting it. An admin, or the creator by `users.id` (T10 PR
 * F2) - the creator keeps the right across a rename, and an item whose creator
 * column is a defined NULL belongs to nobody but an admin.
 *
 * @param {object|null} authedUser
 * @param {object} item - A mapped library item
 * @returns {boolean}
 */
export function canEditOrganizationItem(authedUser, item) {
  // The organization shelf is read-only where sharing is off (D181), for everyone.
  if (!sharingEnabled()) return false;
  if (authedUser?.isAdmin) return true;
  return matchesIdentity(authedUser, { userId: item?.createdBy?.id });
}

/**
 * The reader's verdict on an item they may read: the personal shelf holds
 * only the reader's own items, the organization shelf follows
 * {@link canEditOrganizationItem}.
 *
 * @param {object|null} authedUser
 * @param {object} item - A mapped library item the reader may read
 * @returns {boolean}
 */
export function canEditLibraryItem(authedUser, item) {
  return item?.shelf === 'personal'
    ? true
    : canEditOrganizationItem(authedUser, item);
}
