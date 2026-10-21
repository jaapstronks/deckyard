/**
 * Edit API key permissions modal (B813): change what an existing key may do
 * without rotating it. The change applies from the key's next request on.
 */

import { h } from '../../../lib/dom/index.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { createModal, createModalActions } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { updateApiKeyPermissions } from './actions.js';
import {
  createPermissionCheckboxes,
  permissionOptions,
} from './permission-options.js';

/**
 * Show the modal that edits an API key's permissions.
 * @param {Object} key - The key, in the listed shape
 * @param {(updated: Object) => void} onSuccess - Called with the updated key
 * @returns {Object} The modal
 */
export function showEditPermissionsModal(key, onSuccess) {
  const modal = createModal({
    title: t('settings.apiKeys.editModal.title', 'Edit permissions'),
  });

  const current = Array.isArray(key.permissions) ? key.permissions : [];
  // Permissions this dialog does not offer (a fork's own) are not ours to
  // drop: they ride along unchanged with whatever is picked here.
  const offered = new Set(permissionOptions().map((p) => p.value));
  const carried = current.filter((p) => !offered.has(p));

  const form = h('div', { class: 'stack modal-form' });

  const details = h('div', { class: 'api-key-revoke-details' }, [
    h('strong', { text: key.name }),
    h('code', { class: 'api-key-prefix', text: `${key.prefix}...` }),
  ]);

  const help = h('p', {
    class: 'help',
    text: t(
      'settings.apiKeys.editModal.help',
      'The key stays the same. Applications using it get the new permissions on their next request.',
    ),
  });

  const labelId = `api-key-edit-permissions-${key.id}`;
  const checkboxes = createPermissionCheckboxes({ checked: current });
  checkboxes.el.setAttribute('role', 'group');
  checkboxes.el.setAttribute('aria-labelledby', labelId);
  const permissionsField = h('div', { class: 'stack', style: 'gap: 8px;' }, [
    h('span', {
      class: 'field-label',
      id: labelId,
      text: t('settings.apiKeys.createModal.permissionsLabel', 'Permissions'),
    }),
    checkboxes.el,
  ]);

  // `status` carries progress only; a refusal goes in the inline error beside
  // the action (docs/reference/feedback-surfaces.md).
  const status = h('div', { class: 'help modal-status', role: 'status' });
  const refusal = createInlineError({ callout: true });

  const actions = createModalActions({
    cancelText: t('common.cancel', 'Cancel'),
    actionText: t('settings.apiKeys.editModal.save', 'Save permissions'),
    onCancel: () => modal.requestClose(),
    onAction: () => submit(),
  });
  actions.wrap.classList.add('api-key-modal-buttons');

  form.append(
    details,
    help,
    permissionsField,
    status,
    refusal.el,
    actions.wrap,
  );
  modal.append(form);
  modal.show(document.body);

  return modal;

  /**
   * Lock or unlock the form while the request runs.
   * @param {boolean} disabled - Whether the form is locked
   */
  function setDisabled(disabled) {
    actions.setDisabled(disabled);
    checkboxes.setDisabled(disabled);
  }

  /**
   * Validate and save the new permission list.
   * @returns {Promise<void>}
   */
  async function submit() {
    if (modal.isBusy()) return;

    refusal.clear();
    const picked = checkboxes.selected();
    if (picked.length === 0) {
      status.textContent = '';
      refusal.show(
        t(
          'settings.apiKeys.createModal.permissionRequired',
          'Please select at least one permission.',
        ),
      );
      return;
    }

    modal.setBusy(true);
    setDisabled(true);
    status.textContent = t('settings.apiKeys.editModal.saving', 'Saving…');

    const result = await updateApiKeyPermissions(key.id, [
      ...picked,
      ...carried,
    ]);

    if (result.key) {
      modal.setBusy(false);
      modal.close();
      onSuccess(result.key);
    } else {
      status.textContent = '';
      refusal.show(
        result.error ||
          t(
            'settings.apiKeys.editModal.error',
            'Failed to update the permissions.',
          ),
      );
      modal.setBusy(false);
      setDisabled(false);
    }
  }
}
