/**
 * Revoke API Key confirmation modal.
 */

import { h } from '../../../lib/dom.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { createModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { revokeApiKey } from './actions.js';

/**
 * Show confirmation modal to revoke an API key.
 * @param {Object} key - The API key to revoke
 * @param {Function} onSuccess - Callback after successful revocation
 */
export function showRevokeModal(key, onSuccess) {
  const modal = createModal({
    title: t('settings.apiKeys.revokeModal.title', 'Revoke API Key'),
  });

  const message = h('div', { class: 'stack', style: 'gap: 12px;' });
  message.append(
    h('p', {
      text: t(
        'settings.apiKeys.revokeModal.message',
        'Are you sure you want to revoke this API key? This action cannot be undone.',
      ),
    }),
    h('div', { class: 'api-key-revoke-details' }, [
      h('strong', { text: key.name }),
      h('code', { class: 'api-key-prefix', text: `${key.prefix}...` }),
    ]),
  );

  const warning = h('p', {
    class: 'help',
    text: t(
      'settings.apiKeys.revokeModal.warning',
      'Any applications using this key will immediately lose access.',
    ),
  });

  // `status` carries progress only ("Deleting…", "Saving…"). A refusal is a
  // state of this form, so it goes in the one element for that, beside the
  // action and staying until the next attempt
  // (docs/reference/feedback-surfaces.md).
  const status = h('div', { class: 'help modal-status', role: 'status' });
  const refusal = createInlineError({ callout: true });

  const btnRevoke = h('button', {
    class: 'btn btn-danger',
    text: t('settings.apiKeys.revokeModal.confirm', 'Revoke Key'),
    type: 'button',
    onclick: () => submit(),
  });

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    type: 'button',
    onclick: () => modal.requestClose(),
  });

  const btnRow = h('div', { class: 'row is-end modal-actions' });
  btnRow.append(btnCancel, btnRevoke);

  modal.append(message, warning, status, refusal.el, btnRow);
  modal.show(document.body);

  return modal;

  /**
   * Revoke the key and report the outcome.
   * @returns {Promise<void>}
   */
  async function submit() {
    if (modal.isBusy()) return;

    refusal.clear();
    modal.setBusy(true);
    btnRevoke.disabled = true;
    btnCancel.disabled = true;
    status.textContent = t(
      'settings.apiKeys.revokeModal.revoking',
      'Revoking…',
    );

    const result = await revokeApiKey(key.id);

    if (result.success) {
      toast.success(
        t('settings.apiKeys.revokeModal.success', 'API key revoked.'),
      );
      modal.setBusy(false);
      modal.close();
      onSuccess();
    } else {
      status.textContent = '';
      refusal.show(
        result.error ||
          t('settings.apiKeys.revokeModal.error', 'Failed to revoke API key.'),
      );
      modal.setBusy(false);
      btnRevoke.disabled = false;
      btnCancel.disabled = false;
    }
  }
}
