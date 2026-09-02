/**
 * Add user modal.
 */

import { api } from '../../../lib/api.js';
import { h } from '../../../lib/dom.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { createModal, createModalActions } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';

/**
 * Show modal to add a new user.
 * @param {Function} onSuccess - Callback after successful addition
 */
export function showAddModal(onSuccess) {
  const modal = createModal({
    title: t('admin.users.addModal.title', 'Add new user'),
  });

  const form = h('div', { class: 'stack modal-form' });

  const emailInput = h('input', {
    class: 'form-input',
    type: 'email',
    placeholder: t('admin.users.addModal.emailPlaceholder', 'user@example.com'),
  });

  const nameInput = h('input', {
    class: 'form-input',
    type: 'text',
    placeholder: t(
      'admin.users.addModal.namePlaceholder',
      'Full name (optional)',
    ),
  });

  const roleSelect = h('select', { class: 'form-input' });
  roleSelect.append(
    h('option', { value: 'user', text: t('admin.users.roleUser', 'User') }),
    h('option', {
      value: 'admin',
      text: t('admin.users.roleAdmin', 'Administrator'),
    }),
  );

  const sendInviteCheck = h('label', { class: 'row', style: 'gap: 8px;' }, [
    h('input', { type: 'checkbox', checked: true }),
    h('span', {
      text: t('admin.users.addModal.sendInvitation', 'Send invitation email'),
    }),
  ]);

  // `status` carries progress only ("Deleting…", "Saving…"). A refusal is a
  // state of this form, so it goes in the one element for that, beside the
  // action and staying until the next attempt
  // (docs/reference/feedback-surfaces.md).
  const status = h('div', { class: 'help modal-status', role: 'status' });
  const refusal = createInlineError({ callout: true });

  const actions = createModalActions({
    cancelText: t('common.cancel', 'Cancel'),
    actionText: t('admin.users.addModal.submit', 'Add user'),
    onCancel: () => modal.requestClose(),
    onAction: () => submit(),
  });

  form.append(
    emailInput,
    nameInput,
    roleSelect,
    sendInviteCheck,
    status,
    refusal.el,
    actions.wrap,
  );
  modal.append(form);
  modal.show(document.body);

  requestAnimationFrame(() => {
    try {
      emailInput.focus();
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
    emailInput.disabled = disabled;
    nameInput.disabled = disabled;
    roleSelect.disabled = disabled;
  }

  /**
   * Validate, create the user, and report the outcome.
   * @returns {Promise<void>}
   */
  async function submit() {
    if (modal.isBusy()) return;

    refusal.clear();
    const email = emailInput.value.trim();
    const name = nameInput.value.trim();
    const role = roleSelect.value;
    const sendInvitation = sendInviteCheck.querySelector('input').checked;

    if (!email || !email.includes('@')) {
      status.textContent = '';
      refusal.show(
        t(
          'admin.users.addModal.invalidEmail',
          'Please enter a valid email address.',
        ),
        { control: emailInput },
      );
      return;
    }

    modal.setBusy(true);
    setDisabled(true);
    status.textContent = t('admin.users.addModal.adding', 'Adding…');

    try {
      const created = await api('/api/admin/users', {
        method: 'POST',
        body: { email, name, role, sendInvitation },
      });
      // The account exists either way; the mail is a separate outcome the
      // route now reports honestly. Saying "added" and nothing else would
      // leave the admin waiting for a person who never got a setup link.
      if (sendInvitation && !created?.invitationSent) {
        toast.error(
          t(
            'admin.users.addModal.successNoEmail',
            'User added, but the invitation email could not be sent. Check the email configuration.',
          ),
        );
      } else {
        toast.success(
          t('admin.users.addModal.success', 'User added successfully.'),
        );
      }
      modal.setBusy(false);
      modal.close();
      onSuccess();
    } catch (e) {
      status.textContent = '';
      refusal.show(
        e.message?.includes('exists')
          ? t(
              'admin.users.addModal.alreadyExists',
              'A user with this email already exists.',
            )
          : t('admin.users.addModal.error', 'Failed to add user.'),
      );
      modal.setBusy(false);
      setDisabled(false);
    }
  }
}
