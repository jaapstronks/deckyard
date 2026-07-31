/**
 * Admin user actions - API calls and confirmations.
 */

import { api } from '../../../lib/api.js';
import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { confirmModal } from '../../../lib/dom/modal.js';

/**
 * Fetch users from the API.
 * @param {Function} onSuccess - Callback with users array
 * @param {Function} onError - Callback for error handling
 * @returns {Promise<void>}
 */
export async function fetchUsers(onSuccess, onError) {
  try {
    const data = await api('/api/admin/users');
    if (data.users) {
      onSuccess(data.users);
    } else {
      onError();
    }
  } catch (e) {
    onError();
  }
}

/**
 * Confirm and delete a user.
 * @param {Object} targetUser - User to delete
 * @param {Function} onSuccess - Callback after successful deletion
 * @returns {Promise<void>}
 */
export async function confirmDelete(targetUser, onSuccess) {
  const confirmed = await confirmModal(h, document.body, {
    title: t('admin.users.delete', 'Delete user'),
    message: t('admin.users.deleteConfirm', 'Are you sure you want to delete this user? This action cannot be undone.'),
    confirmLabel: t('admin.users.delete', 'Delete user'),
    danger: true,
  });

  if (!confirmed) return;

  try {
    await api(`/api/admin/users/${targetUser.id}`, { method: 'DELETE' });
    toast.success(t('admin.users.deleteSuccess', 'User deleted successfully.'));
    onSuccess();
  } catch (e) {
    toast.error(t('admin.users.deleteError', 'Failed to delete user.'));
  }
}

/**
 * Resend invitation to a user.
 * @param {Object} targetUser - User to resend invitation to
 * @param {HTMLButtonElement} btn - Button element (for loading state)
 * @returns {Promise<void>}
 */
export async function resendInvitation(targetUser, btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('admin.users.invitationSending', 'Sending…');

  try {
    const res = await api(`/api/admin/users/${targetUser.id}/resend-invitation`, { method: 'POST' });
    // A resend rotates the setup token whether or not the mail leaves the
    // instance, so a 200 is not the same as "it arrived". The route reports
    // the send itself, and only that may be called sent.
    if (res?.invitationSent) {
      toast.success(t('admin.users.invitationSent', 'Invitation sent.'));
    } else {
      toast.error(
        t(
          'admin.users.invitationNotSent',
          'A new setup link was created, but the email could not be sent. Check the email configuration.'
        )
      );
    }
  } catch (e) {
    toast.error(e.message || t('admin.users.invitationError', 'Failed to send invitation.'));
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
