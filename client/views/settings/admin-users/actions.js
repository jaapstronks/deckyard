/**
 * Admin user actions - API calls and confirmations.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/toast.js';
import { confirmModal } from '../../../lib/modal.js';

/**
 * Fetch users from the API.
 * @param {Function} onSuccess - Callback with users array
 * @param {Function} onError - Callback for error handling
 * @returns {Promise<void>}
 */
export async function fetchUsers(onSuccess, onError) {
  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (res.ok && data.users) {
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
    const res = await fetch(`/api/admin/users/${targetUser.id}`, {
      method: 'DELETE',
    });

    if (res.ok) {
      toast.success(t('admin.users.deleteSuccess', 'User deleted successfully.'));
      onSuccess();
    } else {
      toast.error(t('admin.users.deleteError', 'Failed to delete user.'));
    }
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
    const res = await fetch(`/api/admin/users/${targetUser.id}/resend-invitation`, {
      method: 'POST',
    });

    if (res.ok) {
      toast.success(t('admin.users.invitationSent', 'Invitation sent.'));
    } else {
      const data = await res.json();
      toast.error(data.error || t('admin.users.invitationError', 'Failed to send invitation.'));
    }
  } catch (e) {
    toast.error(t('admin.users.invitationError', 'Failed to send invitation.'));
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
