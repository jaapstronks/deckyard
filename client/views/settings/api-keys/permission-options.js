/**
 * The permission choices an API key offers, and the checkbox group that picks
 * from them. One builder for the create dialog and the edit-permissions dialog
 * (B813), so the two cannot offer different lists.
 */

import { h } from '../../../lib/dom/index.js';
import { labeledCheckbox } from '../../../lib/dom/labeled-checkbox.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * The permissions the dialogs offer, with their copy. The server's
 * `AVAILABLE_PERMISSIONS` may hold more (a fork adds its own); those are not
 * offered here and are carried over unchanged by the edit dialog.
 *
 * @returns {Array<{value: string, label: string, desc: string, defaultChecked: boolean}>}
 */
export function permissionOptions() {
  return [
    {
      value: 'read',
      label: t('settings.apiKeys.permissions.read', 'Read'),
      desc: t(
        'settings.apiKeys.permissionDesc.read',
        'Read presentations, themes, and slide types',
      ),
      defaultChecked: true,
    },
    {
      value: 'write',
      label: t('settings.apiKeys.permissions.write', 'Write'),
      desc: t(
        'settings.apiKeys.permissionDesc.write',
        'Create, update, and delete presentations',
      ),
      defaultChecked: true,
    },
    {
      value: 'ai',
      label: t('settings.apiKeys.permissions.ai', 'AI'),
      desc: t(
        'settings.apiKeys.permissionDesc.ai',
        'Use AI generation and refinement features',
      ),
      defaultChecked: false,
    },
    {
      value: 'export',
      label: t('settings.apiKeys.permissions.export', 'Export'),
      desc: t(
        'settings.apiKeys.permissionDesc.export',
        'Export presentations to HTML, JSON, or PDF',
      ),
      defaultChecked: false,
    },
    {
      value: 'comments:read',
      label: t('settings.apiKeys.permissions.commentsRead', 'Comments: read'),
      desc: t(
        'settings.apiKeys.permissionDesc.commentsRead',
        'Read comments on accessible presentations',
      ),
      defaultChecked: false,
    },
    {
      value: 'comments:write',
      label: t('settings.apiKeys.permissions.commentsWrite', 'Comments: write'),
      desc: t(
        'settings.apiKeys.permissionDesc.commentsWrite',
        'Add comments and replies, resolve or reopen them',
      ),
      defaultChecked: false,
    },
    {
      value: 'collaborators:read',
      label: t(
        'settings.apiKeys.permissions.collaboratorsRead',
        'Collaborators: read',
      ),
      desc: t(
        'settings.apiKeys.permissionDesc.collaboratorsRead',
        'See who has access to presentations you manage',
      ),
      defaultChecked: false,
    },
    {
      value: 'collaborators:write',
      label: t(
        'settings.apiKeys.permissions.collaboratorsWrite',
        'Collaborators: write',
      ),
      desc: t(
        'settings.apiKeys.permissionDesc.collaboratorsWrite',
        'Give organization members access to presentations you manage',
      ),
      defaultChecked: false,
    },
  ];
}

/**
 * Render the permission checkbox group.
 *
 * @param {Object} [options]
 * @param {string[]} [options.checked] - Values to check; absent → each
 *   option's own default (the create dialog).
 * @returns {{
 *   el: HTMLElement,
 *   selected: () => string[],
 *   setDisabled: (disabled: boolean) => void,
 * }}
 */
export function createPermissionCheckboxes({ checked } = {}) {
  const el = h('div', { class: 'stack', style: 'gap: 8px;' });

  for (const permission of permissionOptions()) {
    const { el: checkRow } = labeledCheckbox({
      className: 'api-key-permission-checkbox',
      checked: Array.isArray(checked)
        ? checked.includes(permission.value)
        : permission.defaultChecked,
      inputAttrs: {
        value: permission.value,
        'data-permission': permission.value,
      },
      content: h('div', { class: 'api-key-permission-text' }, [
        h('span', {
          class: 'api-key-permission-label',
          text: permission.label,
        }),
        h('span', { class: 'api-key-permission-desc', text: permission.desc }),
      ]),
    });
    el.append(checkRow);
  }

  return {
    el,
    selected: () =>
      Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(
        (cb) => cb.value,
      ),
    setDisabled: (disabled) => {
      el.querySelectorAll('input').forEach((cb) => (cb.disabled = disabled));
    },
  };
}
