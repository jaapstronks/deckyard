/**
 * Revoke API Key confirmation modal.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { revokeApiKey } from './actions.js';

/**
 * Show confirmation modal to revoke an API key.
 * @param {Object} key - The API key to revoke
 * @param {Function} onSuccess - Callback after successful revocation
 */
export function showRevokeModal(key, onSuccess) {
  const overlay = h('div', { class: 'modal-overlay' });
  const modal = h('div', { class: 'modal' });

  const modalTitle = h('h3', {
    text: t('settings.apiKeys.revokeModal.title', 'Revoke API Key'),
  });

  const message = h('div', { class: 'stack', style: 'gap: 12px;' });
  message.append(
    h('p', {
      text: t(
        'settings.apiKeys.revokeModal.message',
        'Are you sure you want to revoke this API key? This action cannot be undone.'
      ),
    }),
    h('div', { class: 'api-key-revoke-details' }, [
      h('strong', { text: key.name }),
      h('code', { class: 'api-key-prefix', text: `${key.prefix}...` }),
    ])
  );

  const warning = h('p', {
    class: 'help',
    text: t(
      'settings.apiKeys.revokeModal.warning',
      'Any applications using this key will immediately lose access.'
    ),
  });

  const status = h('div', { class: 'help modal-status' });

  const btnRevoke = h('button', {
    class: 'btn btn-danger',
    text: t('settings.apiKeys.revokeModal.confirm', 'Revoke Key'),
    type: 'button',
  });

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    type: 'button',
  });

  let busy = false;
  btnRevoke.onclick = async () => {
    if (busy) return;

    busy = true;
    btnRevoke.disabled = true;
    status.textContent = t('settings.apiKeys.revokeModal.revoking', 'Revoking...');

    const result = await revokeApiKey(key.id);

    if (result.success) {
      toast.success(t('settings.apiKeys.revokeModal.success', 'API key revoked.'));
      overlay.remove();
      onSuccess();
    } else {
      status.textContent = result.error || t('settings.apiKeys.revokeModal.error', 'Failed to revoke API key.');
      busy = false;
      btnRevoke.disabled = false;
    }
  };

  btnCancel.onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  const btnRow = h('div', { class: 'row is-end', style: 'gap: 8px; margin-top: 16px;' });
  btnRow.append(btnCancel, btnRevoke);

  modal.append(modalTitle, message, warning, status, btnRow);
  overlay.append(modal);
  document.body.append(overlay);
}
