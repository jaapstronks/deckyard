/**
 * Create API Key modal - dialog for creating new API keys.
 */

import { h } from '../../../lib/dom.js';
import { labeledCheckbox } from '../../../lib/dom/labeled-checkbox.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import {
  confirmModal,
  createModal,
  createModalActions,
} from '../../../lib/dom/modal.js';
import { createApiKey } from './actions.js';

/**
 * Show modal to display the newly created key (shown only once).
 * @param {string} fullKey - The full API key
 * @param {Function} onClose - Callback when modal is closed
 */
function showKeyDisplayModal(fullKey, onClose) {
  // No Escape, no backdrop click, no header close: the key is shown exactly
  // once, so every exit runs through Done and its "you have not copied it yet"
  // check. Losing it to a stray click is unrecoverable.
  const modal = createModal(h, {
    title: t('settings.apiKeys.keyCreated', 'API Key Created'),
    modalClass: 'api-key-display-modal',
    closeButton: false,
    closeOnBackdrop: false,
    closeOnEscape: false,
  });

  const warning = h('div', { class: 'api-key-warning' }, [
    h('strong', {
      text: t('settings.apiKeys.copyWarningTitle', 'Copy this key now'),
    }),
    h('p', {
      text: t(
        'settings.apiKeys.copyWarning',
        'This is the only time you will see this key. Store it somewhere safe.',
      ),
    }),
  ]);

  const keyDisplay = h('div', { class: 'api-key-full-display' });
  const keyCode = h('code', {
    class: 'api-key-full',
    text: fullKey,
  });
  keyDisplay.append(keyCode);

  const copyBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('settings.apiKeys.copyKey', 'Copy API Key'),
  });

  let copied = false;
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(fullKey);
    copyBtn.textContent = t('settings.apiKeys.copied', 'Copied!');
    copied = true;
    setTimeout(() => {
      copyBtn.textContent = t('settings.apiKeys.copyKey', 'Copy API Key');
    }, 2000);
  };

  const doneBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.done', 'Done'),
  });

  doneBtn.onclick = async () => {
    if (!copied) {
      const confirmClose = await confirmModal(h, document.body, {
        title: t('common.close', 'Close'),
        message: t(
          'settings.apiKeys.confirmCloseWithoutCopy',
          "You haven't copied the key yet. Are you sure you want to close?",
        ),
      });
      if (!confirmClose) return;
    }
    modal.close();
    onClose();
  };

  const btnRow = h('div', { class: 'row is-end modal-actions' });
  btnRow.append(doneBtn, copyBtn);

  modal.append(warning, keyDisplay, btnRow);
  modal.show(document.body);
}

/**
 * Show modal to create a new API key.
 * @param {Function} onSuccess - Callback after successful creation
 */
export function showCreateModal(onSuccess) {
  const modal = createModal(h, {
    title: t('settings.apiKeys.createModal.title', 'Create API Key'),
  });

  const form = h('div', { class: 'stack modal-form' });

  // Name input
  const nameLabel = h('label', { class: 'stack', style: 'gap: 4px;' });
  const nameLabelText = h('span', {
    class: 'field-label',
    text: t('settings.apiKeys.createModal.nameLabel', 'Key Name'),
  });
  const nameInput = h('input', {
    class: 'form-input',
    type: 'text',
    placeholder: t(
      'settings.apiKeys.createModal.namePlaceholder',
      'e.g., Claude Desktop, CI Pipeline',
    ),
  });
  nameLabel.append(nameLabelText, nameInput);

  // Permissions
  const permissionsLabel = h('div', { class: 'stack', style: 'gap: 8px;' });
  const permissionsLabelText = h('span', {
    class: 'field-label',
    text: t('settings.apiKeys.createModal.permissionsLabel', 'Permissions'),
  });

  const permissionCheckboxes = h('div', { class: 'stack', style: 'gap: 8px;' });

  const permissions = [
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
  ];

  for (const permission of permissions) {
    const { element: checkRow } = labeledCheckbox({
      className: 'api-key-permission-checkbox',
      checked: permission.defaultChecked,
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
    permissionCheckboxes.append(checkRow);
  }

  permissionsLabel.append(permissionsLabelText, permissionCheckboxes);

  // Status message
  const status = h('div', { class: 'help modal-status', role: 'status' });

  const actions = createModalActions(h, {
    cancelText: t('common.cancel', 'Cancel'),
    actionText: t('settings.apiKeys.createModal.create', 'Create Key'),
    onCancel: () => modal.requestClose(),
    onAction: () => submit(),
  });
  actions.wrap.classList.add('api-key-modal-buttons');

  form.append(nameLabel, permissionsLabel, status, actions.wrap);
  modal.append(form);
  modal.show(document.body);

  requestAnimationFrame(() => {
    try {
      nameInput.focus();
    } catch {
      // ignore
    }
  });

  return modal;

  /**
   * Set the disabled state of every input in the form.
   * @param {boolean} disabled - Whether the form is locked
   */
  function setDisabled(disabled) {
    actions.setDisabled(disabled);
    nameInput.disabled = disabled;
    permissionCheckboxes
      .querySelectorAll('input')
      .forEach((cb) => (cb.disabled = disabled));
  }

  /**
   * Validate, create the key, and hand it to the show-once display.
   * @returns {Promise<void>}
   */
  async function submit() {
    if (modal.isBusy()) return;

    const name = nameInput.value.trim();
    const selectedPermissions = Array.from(
      permissionCheckboxes.querySelectorAll('input[type="checkbox"]:checked'),
    ).map((cb) => cb.value);

    if (!name) {
      status.textContent = t(
        'settings.apiKeys.createModal.nameRequired',
        'Please enter a key name.',
      );
      nameInput.focus();
      return;
    }

    if (selectedPermissions.length === 0) {
      status.textContent = t(
        'settings.apiKeys.createModal.permissionRequired',
        'Please select at least one permission.',
      );
      return;
    }

    modal.setBusy(true);
    setDisabled(true);
    status.textContent = t(
      'settings.apiKeys.createModal.creating',
      'Creating…',
    );

    const result = await createApiKey({
      name,
      permissions: selectedPermissions,
    });

    if (result.key) {
      // Show the key display modal
      showKeyDisplayModal(result.key.key, () => {
        toast.success(
          t(
            'settings.apiKeys.createModal.success',
            'API key created successfully.',
          ),
        );
        modal.setBusy(false);
        modal.close();
        onSuccess();
      });
    } else {
      status.textContent =
        result.error ||
        t('settings.apiKeys.createModal.error', 'Failed to create API key.');
      modal.setBusy(false);
      setDisabled(false);
    }
  }
}
