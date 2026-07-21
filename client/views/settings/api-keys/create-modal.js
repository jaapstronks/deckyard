/**
 * Create API Key modal - dialog for creating new API keys.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { createApiKey } from './actions.js';

/**
 * Show modal to display the newly created key (shown only once).
 * @param {string} fullKey - The full API key
 * @param {Function} onClose - Callback when modal is closed
 */
function showKeyDisplayModal(fullKey, onClose) {
  const overlay = h('div', { class: 'modal-overlay' });
  const modal = h('div', { class: 'modal api-key-display-modal' });

  const modalTitle = h('h3', {
    text: t('settings.apiKeys.keyCreated', 'API Key Created'),
  });

  const warning = h('div', { class: 'api-key-warning' }, [
    h('strong', { text: t('settings.apiKeys.copyWarningTitle', 'Copy this key now') }),
    h('p', {
      text: t(
        'settings.apiKeys.copyWarning',
        'This is the only time you will see this key. Store it somewhere safe.'
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
          'You haven\'t copied the key yet. Are you sure you want to close?'
        ),
      });
      if (!confirmClose) return;
    }
    overlay.remove();
    onClose();
  };

  const btnRow = h('div', { class: 'row is-end', style: 'gap: 8px; margin-top: 16px;' });
  btnRow.append(doneBtn, copyBtn);

  modal.append(modalTitle, warning, keyDisplay, btnRow);
  overlay.append(modal);
  document.body.append(overlay);
}

/**
 * Show modal to create a new API key.
 * @param {Function} onSuccess - Callback after successful creation
 */
export function showCreateModal(onSuccess) {
  const overlay = h('div', { class: 'modal-overlay' });
  const modal = h('div', { class: 'modal' });

  const modalTitle = h('h3', {
    text: t('settings.apiKeys.createModal.title', 'Create API Key'),
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
    placeholder: t('settings.apiKeys.createModal.namePlaceholder', 'e.g., Claude Desktop, CI Pipeline'),
  });
  nameLabel.append(nameLabelText, nameInput);

  // Scopes
  const scopesLabel = h('div', { class: 'stack', style: 'gap: 8px;' });
  const scopesLabelText = h('span', {
    class: 'field-label',
    text: t('settings.apiKeys.createModal.scopesLabel', 'Permissions'),
  });

  const scopeCheckboxes = h('div', { class: 'stack', style: 'gap: 8px;' });

  const scopes = [
    { value: 'read', label: t('settings.apiKeys.scopes.read', 'Read'), desc: t('settings.apiKeys.scopeDesc.read', 'Read presentations, themes, and slide types'), defaultChecked: true },
    { value: 'write', label: t('settings.apiKeys.scopes.write', 'Write'), desc: t('settings.apiKeys.scopeDesc.write', 'Create, update, and delete presentations'), defaultChecked: true },
    { value: 'ai', label: t('settings.apiKeys.scopes.ai', 'AI'), desc: t('settings.apiKeys.scopeDesc.ai', 'Use AI generation and refinement features'), defaultChecked: false },
    { value: 'export', label: t('settings.apiKeys.scopes.export', 'Export'), desc: t('settings.apiKeys.scopeDesc.export', 'Export presentations to HTML, JSON, or PDF'), defaultChecked: false },
    { value: 'comments:read', label: t('settings.apiKeys.scopes.commentsRead', 'Comments: read'), desc: t('settings.apiKeys.scopeDesc.commentsRead', 'Read comments on accessible presentations'), defaultChecked: false },
    { value: 'comments:write', label: t('settings.apiKeys.scopes.commentsWrite', 'Comments: write'), desc: t('settings.apiKeys.scopeDesc.commentsWrite', 'Add comments and replies, resolve or reopen them'), defaultChecked: false },
  ];

  for (const scope of scopes) {
    const checkbox = h('input', {
      type: 'checkbox',
      value: scope.value,
      'data-scope': scope.value,
    });
    if (scope.defaultChecked) checkbox.checked = true;

    const checkRow = h('label', { class: 'api-key-scope-checkbox' }, [
      checkbox,
      h('div', { class: 'api-key-scope-text' }, [
        h('span', { class: 'api-key-scope-label', text: scope.label }),
        h('span', { class: 'api-key-scope-desc', text: scope.desc }),
      ]),
    ]);
    scopeCheckboxes.append(checkRow);
  }

  scopesLabel.append(scopesLabelText, scopeCheckboxes);

  // Status message
  const status = h('div', { class: 'help modal-status' });

  // Buttons
  const btnSubmit = h('button', {
    class: 'btn btn-primary',
    text: t('settings.apiKeys.createModal.create', 'Create Key'),
    type: 'button',
  });

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    type: 'button',
  });

  let busy = false;
  btnSubmit.onclick = async () => {
    if (busy) return;

    const name = nameInput.value.trim();
    const selectedScopes = Array.from(scopeCheckboxes.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => cb.value);

    if (!name) {
      status.textContent = t('settings.apiKeys.createModal.nameRequired', 'Please enter a key name.');
      return;
    }

    if (selectedScopes.length === 0) {
      status.textContent = t('settings.apiKeys.createModal.scopeRequired', 'Please select at least one permission.');
      return;
    }

    busy = true;
    btnSubmit.disabled = true;
    nameInput.disabled = true;
    scopeCheckboxes.querySelectorAll('input').forEach(cb => cb.disabled = true);
    status.textContent = t('settings.apiKeys.createModal.creating', 'Creating...');

    const result = await createApiKey({ name, scopes: selectedScopes });

    if (result.key) {
      // Show the key display modal
      showKeyDisplayModal(result.key.key, () => {
        toast.success(t('settings.apiKeys.createModal.success', 'API key created successfully.'));
        overlay.remove();
        onSuccess();
      });
    } else {
      status.textContent = result.error || t('settings.apiKeys.createModal.error', 'Failed to create API key.');
      busy = false;
      btnSubmit.disabled = false;
      nameInput.disabled = false;
      scopeCheckboxes.querySelectorAll('input').forEach(cb => cb.disabled = false);
    }
  };

  btnCancel.onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  const btnRow = h('div', { class: 'api-key-modal-buttons' });
  btnRow.append(btnCancel, btnSubmit);

  form.append(nameLabel, scopesLabel, status, btnRow);
  modal.append(modalTitle, form);
  overlay.append(modal);
  document.body.append(overlay);
  nameInput.focus();
}
