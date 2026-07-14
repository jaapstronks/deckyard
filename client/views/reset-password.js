import { h } from '../lib/dom.js';
import { t } from '../lib/ui-i18n.js';
import { createBusyManager } from '../lib/busy.js';

export async function renderResetPassword(root, { nav } = {}) {
  const shell = h('div', { class: 'auth-shell' });
  const card = h('div', { class: 'auth-card' });

  // Header
  const header = h('div', { class: 'auth-header' });
  const title = h('h1', {
    class: 'auth-title',
    text: t('resetPassword.title', 'Set a new password'),
  });
  const subtitle = h('p', {
    class: 'auth-subtitle',
    text: t('resetPassword.validating', 'Validating...'),
  });
  header.append(title, subtitle);

  const form = h('div', { class: 'auth-form' });
  const status = h('div', { class: 'auth-status' });

  card.append(header, form);
  shell.append(card);
  root.append(shell);

  // Get token from URL
  const url = new URL(location.href);
  const token = url.searchParams.get('token');

  if (!token) {
    subtitle.textContent = t('resetPassword.invalidToken', 'This reset link is invalid or has expired.');
    const loginLink = h('a', {
      href: '/login',
      class: 'auth-link',
      text: t('resetPassword.goToLogin', 'Go to login'),
    });
    loginLink.onclick = (e) => {
      e.preventDefault();
      nav?.('/login');
    };
    form.append(loginLink);
    return;
  }

  // Validate token
  try {
    const res = await fetch(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
    const data = await res.json();

    if (!data.ok) {
      subtitle.textContent = data.reason === 'expired'
        ? t('resetPassword.expiredToken', 'This reset link has expired. Please request a new one.')
        : t('resetPassword.invalidToken', 'This reset link is invalid or has expired.');

      const forgotLink = h('a', {
        href: '/forgot-password',
        class: 'auth-link',
        text: t('forgotPassword.submit', 'Request new link'),
      });
      forgotLink.onclick = (e) => {
        e.preventDefault();
        nav?.('/forgot-password');
      };
      form.append(forgotLink);
      return;
    }

    // Token is valid - show password form
    subtitle.textContent = t(
      'resetPassword.resetFor',
      'Resetting password for {email}'
    ).replace('{email}', data.maskedEmail);

    const password = h('input', {
      class: 'auth-input',
      type: 'password',
      placeholder: t('resetPassword.password', 'New password'),
      autocomplete: 'new-password',
    });

    const confirmPassword = h('input', {
      class: 'auth-input',
      type: 'password',
      placeholder: t('resetPassword.confirmPassword', 'Confirm password'),
      autocomplete: 'new-password',
    });

    const btn = h('button', {
      class: 'auth-btn',
      text: t('resetPassword.submit', 'Reset password'),
    });

    const busyManager = createBusyManager({
      elements: [password, confirmPassword, btn],
    });

    const submit = async () => {
      if (busyManager.isBusy()) return;

      const pw = password.value || '';
      const pwConfirm = confirmPassword.value || '';

      // Validate
      if (pw.length < 8) {
        status.textContent = t('resetPassword.passwordTooShort', 'Password must be at least 8 characters.');
        status.className = 'auth-status is-error';
        return;
      }

      if (pw !== pwConfirm) {
        status.textContent = t('resetPassword.passwordMismatch', 'Passwords do not match.');
        status.className = 'auth-status is-error';
        return;
      }

      status.textContent = t('resetPassword.resetting', 'Resetting...');
      status.className = 'auth-status';
      busyManager.setBusy(true);

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password: pw }),
        });

        const result = await res.json();

        if (res.ok) {
          // Success - show message and link to login
          form.innerHTML = '';
          const successMsg = h('div', {
            class: 'auth-status is-success',
            text: t('resetPassword.success', 'Password has been reset successfully. You can now log in.'),
          });
          successMsg.style.textAlign = 'left';
          successMsg.style.marginBottom = 'var(--ps-space-4)';

          const loginLink = h('a', {
            href: '/login',
            class: 'auth-btn',
            style: 'text-decoration: none;',
            text: t('resetPassword.goToLogin', 'Go to login'),
          });
          loginLink.onclick = (e) => {
            e.preventDefault();
            nav?.('/login');
          };

          form.append(successMsg, loginLink);
        } else {
          status.textContent = result?.error || t('resetPassword.error', 'Something went wrong. Please try again.');
          status.className = 'auth-status is-error';
          busyManager.setBusy(false);
        }
      } catch (err) {
        status.textContent = t('resetPassword.error', 'Something went wrong. Please try again.');
        status.className = 'auth-status is-error';
        busyManager.setBusy(false);
      }
    };

    btn.onclick = submit;
    password.addEventListener('keydown', (ev) => ev.key === 'Enter' && confirmPassword.focus());
    confirmPassword.addEventListener('keydown', (ev) => ev.key === 'Enter' && submit());

    form.append(password, confirmPassword, btn, status);
    password.focus();

  } catch (err) {
    subtitle.textContent = t('resetPassword.error', 'Something went wrong. Please try again.');
    const loginLink = h('a', {
      href: '/login',
      class: 'auth-link',
      text: t('resetPassword.goToLogin', 'Go to login'),
    });
    loginLink.onclick = (e) => {
      e.preventDefault();
      nav?.('/login');
    };
    form.append(loginLink);
  }
}