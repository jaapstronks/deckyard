/**
 * Copy for the `api_key.permissions_changed` activity event (B813), shared by
 * the Activity view and the home rail so both read the event the same way.
 * The event carries no presentation: its target is the key's name.
 */

import { t } from '../../lib/ui-i18n.js';

/** The event type this module describes. */
export const API_KEY_PERMISSIONS_CHANGED = 'api_key.permissions_changed';

/**
 * The action phrase, between the actor and the key name.
 * @returns {string}
 */
export function apiKeyPermissionsAction() {
  return t(
    'activity.apiKeyPermissionsChanged',
    'changed the permissions of API key',
  );
}

/**
 * One line naming what was added and what was removed, or '' when the event
 * holds no usable before/after lists.
 * @param {Object} event - The activity event
 * @returns {string}
 */
export function apiKeyPermissionsSummary(event) {
  const before = Array.isArray(event?.data?.before) ? event.data.before : null;
  const after = Array.isArray(event?.data?.after) ? event.data.after : null;
  if (!before || !after) return '';
  const added = after.filter((p) => !before.includes(p));
  const removed = before.filter((p) => !after.includes(p));
  const parts = [];
  if (added.length > 0) {
    parts.push(
      t('activity.apiKeyPermissionsAdded', 'Added: {permissions}', {
        permissions: added.join(', '),
      }),
    );
  }
  if (removed.length > 0) {
    parts.push(
      t('activity.apiKeyPermissionsRemoved', 'Removed: {permissions}', {
        permissions: removed.join(', '),
      }),
    );
  }
  return parts.join(' · ');
}
