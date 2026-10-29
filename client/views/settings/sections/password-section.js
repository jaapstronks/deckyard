/**
 * Password change section for user settings.
 * Allows users to change their account password.
 */

import { api, serverSentence } from '../../../lib/api.js';
import { toast } from '../../../lib/dom/toast.js';
import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom/index.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { createFieldWrap } from '../../../lib/dom/field-wrap.js';

/**
 * Create the password change section component.
 * @param {Object} options
 * @returns {Object} { element, setDisabled }
 */
export function createPasswordSection() {
  const card = h('div', { class: 'stack editor-card' });
  card.append(
    h('div', {
      class: 'field-label',
      text: t('settings.changePassword.title', 'Change password'),
    }),
  );

  const hint = h('div', {
    class: 'help',
    text: t(
      'settings.changePassword.hint',
      "Change your account password. You'll stay logged in after changing.",
    ),
  });

  const currentPasswordInput = h('input', {
    class: 'form-input settings-compact-control',
    type: 'password',
    autocomplete: 'current-password',
  });

  const newPasswordInput = h('input', {
    class: 'form-input settings-compact-control',
    type: 'password',
    autocomplete: 'new-password',
  });

  const confirmPasswordInput = h('input', {
    class: 'form-input settings-compact-control',
    type: 'password',
    autocomplete: 'new-password',
  });

  const btnChangePassword = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('settings.changePassword.submit', 'Change password'),
  });

  // `statusEl` carries progress only ("Changing…"). A refusal is a state of
  // the form and goes through the inline helper, naming the field it refuses
  // (docs/reference/feedback-surfaces.md).
  const statusEl = h('div', { class: 'help password-status', role: 'status' });
  const refusal = createInlineError({ callout: true });
  const controlsByField = {
    currentPassword: currentPasswordInput,
    newPassword: newPasswordInput,
  };

  let busy = false;

  btnChangePassword.onclick = async () => {
    if (busy) return;

    const currentPw = currentPasswordInput.value || '';
    const newPw = newPasswordInput.value || '';
    const confirmPw = confirmPasswordInput.value || '';

    refusal.clear();

    // Validation
    if (newPw.length < 8) {
      refusal.show(
        t(
          'settings.changePassword.tooShort',
          'New password must be at least 8 characters.',
        ),
        { control: newPasswordInput },
      );
      return;
    }

    if (newPw !== confirmPw) {
      refusal.show(
        t('settings.changePassword.mismatch', 'New passwords do not match.'),
        { control: confirmPasswordInput },
      );
      return;
    }

    busy = true;
    btnChangePassword.disabled = true;
    currentPasswordInput.disabled = true;
    newPasswordInput.disabled = true;
    confirmPasswordInput.disabled = true;
    statusEl.textContent = t('settings.changePassword.changing', 'Changing…');
    let failure = null;

    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: currentPw,
          newPassword: newPw,
        },
      });
      toast.success(
        t('settings.changePassword.success', 'Password changed successfully.'),
        {
          id: 'password-change',
          durationMs: 3000,
        },
      );
      // Clear fields
      currentPasswordInput.value = '';
      newPasswordInput.value = '';
      confirmPasswordInput.value = '';
      statusEl.textContent = '';
    } catch (e) {
      statusEl.textContent = '';
      failure = e;
    } finally {
      busy = false;
      btnChangePassword.disabled = false;
      currentPasswordInput.disabled = false;
      newPasswordInput.disabled = false;
      confirmPasswordInput.disabled = false;
    }
    // After the inputs are enabled again, so focus can land on the one named.
    if (failure) {
      refusal.show(
        failure.code === 'current_password_incorrect'
          ? t(
              'settings.changePassword.incorrectCurrent',
              'Current password is incorrect.',
            )
          : (serverSentence(failure) ??
              t('settings.changePassword.error', 'Failed to change password.')),
        { control: controlsByField[failure.details?.field] ?? null },
      );
    }
  };

  card.append(
    hint,
    createFieldWrap(
      t('settings.changePassword.currentPassword', 'Current password'),
      currentPasswordInput,
    ),
    createFieldWrap(
      t('settings.changePassword.newPassword', 'New password'),
      newPasswordInput,
    ),
    createFieldWrap(
      t('settings.changePassword.confirmPassword', 'Confirm new password'),
      confirmPasswordInput,
    ),
    btnChangePassword,
    statusEl,
    refusal.el,
  );

  return {
    el: card,
    setDisabled: (disabled) => {
      // Note: This doesn't affect the password change operation,
      // only external disable requests (e.g., when saving other settings)
    },
  };
}
