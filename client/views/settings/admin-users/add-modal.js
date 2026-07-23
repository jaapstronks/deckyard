/**
 * Add user modal.
 */

import { api } from '../../../lib/api.js';
import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';

/**
 * Show modal to add a new user.
 * @param {Function} onSuccess - Callback after successful addition
 */
export function showAddModal(onSuccess) {
  const overlay = h('div', { class: 'modal-overlay' });
  const modal = h('div', { class: 'modal' });

  const modalTitle = h('h3', {
    text: t('admin.users.addModal.title', 'Add new user'),
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
    placeholder: t('admin.users.addModal.namePlaceholder', 'Full name (optional)'),
  });

  const roleSelect = h('select', { class: 'form-select' });
  roleSelect.append(
    h('option', { value: 'user', text: t('admin.users.roleUser', 'User') }),
    h('option', { value: 'admin', text: t('admin.users.roleAdmin', 'Admin') })
  );

  const sendInviteCheck = h('label', { class: 'row', style: 'gap: 8px;' }, [
    h('input', { type: 'checkbox', checked: true }),
    h('span', { text: t('admin.users.addModal.sendInvitation', 'Send invitation email') }),
  ]);

  const status = h('div', { class: 'help modal-status' });

  const btnSubmit = h('button', {
    class: 'btn btn-primary',
    text: t('admin.users.addModal.submit', 'Add user'),
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

    const email = emailInput.value.trim();
    const name = nameInput.value.trim();
    const role = roleSelect.value;
    const sendInvitation = sendInviteCheck.querySelector('input').checked;

    if (!email || !email.includes('@')) {
      status.textContent = t('admin.users.addModal.invalidEmail', 'Please enter a valid email address.');
      return;
    }

    busy = true;
    btnSubmit.disabled = true;
    emailInput.disabled = true;
    nameInput.disabled = true;
    roleSelect.disabled = true;
    status.textContent = t('admin.users.addModal.adding', 'Adding...');

    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: { email, name, role, sendInvitation },
      });
      toast.success(t('admin.users.addModal.success', 'User added successfully.'));
      overlay.remove();
      onSuccess();
    } catch (e) {
      status.textContent = e.message?.includes('exists')
        ? t('admin.users.addModal.alreadyExists', 'A user with this email already exists.')
        : t('admin.users.addModal.error', 'Failed to add user.');
      busy = false;
      btnSubmit.disabled = false;
      emailInput.disabled = false;
      nameInput.disabled = false;
      roleSelect.disabled = false;
    }
  };

  btnCancel.onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  const btnRow = h('div', { class: 'row is-end', style: 'gap: 8px; margin-top: 16px;' });
  btnRow.append(btnCancel, btnSubmit);

  form.append(emailInput, nameInput, roleSelect, sendInviteCheck, status, btnRow);
  modal.append(modalTitle, form);
  overlay.append(modal);
  document.body.append(overlay);
  emailInput.focus();
}
