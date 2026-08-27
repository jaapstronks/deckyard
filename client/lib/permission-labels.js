/**
 * Human-readable names for a permission level.
 *
 * One permission has one name, whether it is being chosen (a select option),
 * reported (a badge) or explained (a tooltip). Every surface that shows a
 * permission — the share modal, the share viewer and the in-app viewer —
 * reads these helpers, so the wording cannot drift apart per view.
 *
 * Share *links* are only ever issued as 'view' or 'comment' (there is no
 * guest-editing flow); 'edit' and 'admin' exist for workspace collaborators.
 * Both live here because they are one vocabulary, not two.
 */

import { t } from './ui-i18n.js';

/** @type {Record<string, { key: string, fallback: string }>} */
const LABELS = {
  view: { key: 'share.permission.view', fallback: 'View only' },
  comment: { key: 'share.permission.comment', fallback: 'Can comment' },
  edit: { key: 'share.permission.edit', fallback: 'Can edit' },
  admin: { key: 'share.permission.admin', fallback: 'Administrator' },
};

/** @type {Record<string, { key: string, fallback: string }>} */
const DESCRIPTIONS = {
  view: {
    key: 'share.permission.viewDescription',
    fallback: 'Can only view the presentation',
  },
  comment: {
    key: 'share.permission.commentDescription',
    fallback: 'Can view and add comments',
  },
  edit: {
    key: 'share.permission.editDescription',
    fallback: 'Can edit the presentation',
  },
  admin: {
    key: 'share.permission.adminDescription',
    fallback: 'Can edit and manage collaborators',
  },
};

/**
 * Get the human-readable label for a permission level.
 * @param {string} permission - 'view' | 'comment' | 'edit' | 'admin'
 * @returns {string} Translated label, or the raw value if it is not a known level.
 */
export function getPermissionLabel(permission) {
  const entry = LABELS[permission];
  return entry ? t(entry.key, entry.fallback) : String(permission ?? '');
}

/**
 * Get the one-line explanation of what a permission level allows.
 * Used as tooltip copy next to the label.
 * @param {string} permission - 'view' | 'comment' | 'edit' | 'admin'
 * @returns {string} Translated description, or '' if it is not a known level.
 */
export function getPermissionDescription(permission) {
  const entry = DESCRIPTIONS[permission];
  return entry ? t(entry.key, entry.fallback) : '';
}
