/**
 * Password change section for user settings.
 * Allows users to change their account password.
 */

import { toast } from '../../../lib/dom/toast.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Create the password change section component.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function for creating DOM elements
 * @returns {Object} { element, setDisabled }
 */
export function createPasswordSection({ h }) {
  const card = h('div', { class: 'stack editor-card' });
  card.append(
    h('div', {
      class: 'field-label',
      text: t('settings.changePassword.title', 'Change password'),
    })
  );

  const hint = h('div', {
    class: 'help',
    text: t(
      'settings.changePassword.hint',
      "Change your account password. You'll stay logged in after changing."
    ),
  });

  const currentPasswordInput = h('input', {
    class: 'form-input settings-compact-control',
    type: 'password',
    placeholder: t('settings.changePassword.currentPassword', 'Current password'),
    autocomplete: 'current-password',
  });

  const newPasswordInput = h('input', {
    class: 'form-input settings-compact-control',
    type: 'password',
    placeholder: t('settings.changePassword.newPassword', 'New password'),
    autocomplete: 'new-password',
  });

  const confirmPasswordInput = h('input', {
    class: 'form-input settings-compact-control',
    type: 'password',
    placeholder: t('settings.changePassword.confirmPassword', 'Confirm new password'),
    autocomplete: 'new-password',
  });

  const btnChangePassword = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('settings.changePassword.submit', 'Change password'),
  });

  const statusEl = h('div', { class: 'help password-status' });

  let busy = false;

  btnChangePassword.onclick = async () => {
    if (busy) return;

    const currentPw = currentPasswordInput.value || '';
    const newPw = newPasswordInput.value || '';
    const confirmPw = confirmPasswordInput.value || '';

    // Validation
    if (newPw.length < 8) {
      statusEl.textContent = t(
        'settings.changePassword.tooShort',
        'New password must be at least 8 characters.'
      );
      return;
    }

    if (newPw !== confirmPw) {
      statusEl.textContent = t(
        'settings.changePassword.mismatch',
        'New passwords do not match.'
      );
      return;
    }

    busy = true;
    btnChangePassword.disabled = true;
    currentPasswordInput.disabled = true;
    newPasswordInput.disabled = true;
    confirmPasswordInput.disabled = true;
    statusEl.textContent = t('settings.changePassword.changing', 'Changing...');

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPw,
          newPassword: newPw,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(t('settings.changePassword.success', 'Password changed successfully.'), {
          id: 'password-change',
          durationMs: 3000,
        });
        // Clear fields
        currentPasswordInput.value = '';
        newPasswordInput.value = '';
        confirmPasswordInput.value = '';
        statusEl.textContent = '';
      } else {
        const errorMsg = data?.error?.includes('incorrect')
          ? t('settings.changePassword.incorrectCurrent', 'Current password is incorrect.')
          : t('settings.changePassword.error', 'Failed to change password.');
        statusEl.textContent = errorMsg;
      }
    } catch (e) {
      statusEl.textContent = t('settings.changePassword.error', 'Failed to change password.');
    } finally {
      busy = false;
      btnChangePassword.disabled = false;
      currentPasswordInput.disabled = false;
      newPasswordInput.disabled = false;
      confirmPasswordInput.disabled = false;
    }
  };

  card.append(
    hint,
    currentPasswordInput,
    newPasswordInput,
    confirmPasswordInput,
    btnChangePassword,
    statusEl
  );

  return {
    element: card,
    setDisabled: (disabled) => {
      // Note: This doesn't affect the password change operation,
      // only external disable requests (e.g., when saving other settings)
    },
  };
}