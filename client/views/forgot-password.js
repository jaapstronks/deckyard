import { h } from '../lib/dom.js';
import { t } from '../lib/ui-i18n.js';
import { createBusyManager } from '../lib/dom/busy.js';

export async function renderForgotPassword(root, { nav } = {}) {
  const shell = h('div', { class: 'auth-shell' });
  const card = h('div', { class: 'auth-card' });

  // Header
  const header = h('div', { class: 'auth-header' });
  const title = h('h1', {
    class: 'auth-title',
    text: t('forgotPassword.title', 'Reset your password'),
  });
  const subtitle = h('p', {
    class: 'auth-subtitle',
    text: t(
      'forgotPassword.help',
      "Enter your email address and we'll send you a link to reset your password."
    ),
  });
  header.append(title, subtitle);

  const form = h('div', { class: 'auth-form' });
  const email = h('input', {
    class: 'auth-input',
    type: 'email',
    placeholder: t('forgotPassword.email', 'Email'),
    autocomplete: 'username',
  });
  const status = h('div', { class: 'auth-status' });

  const btn = h('button', {
    class: 'auth-btn',
    text: t('forgotPassword.submit', 'Send reset link'),
  });

  const backLink = h('a', {
    href: '/login',
    class: 'auth-link auth-link-subtle',
    text: t('forgotPassword.backToLogin', 'Back to login'),
  });

  backLink.onclick = (e) => {
    e.preventDefault();
    nav?.('/login');
  };

  const busyManager = createBusyManager({
    elements: [email, btn],
  });

  let submitted = false;

  const submit = async () => {
    if (busyManager.isBusy()) return;

    const e = (email.value || '').trim();
    if (!e || !e.includes('@')) {
      status.textContent = t(
        'forgotPassword.error',
        'Please enter a valid email address.'
      );
      status.className = 'auth-status is-error';
      return;
    }

    status.textContent = t('forgotPassword.sending', 'Sending...');
    status.className = 'auth-status';
    busyManager.setBusy(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e }),
      });

      const data = await res.json();

      if (res.ok) {
        submitted = true;
        status.textContent = '';
        status.className = 'auth-status';

        // Show success message
        form.innerHTML = '';
        const successMsg = h('div', {
          class: 'auth-status is-success',
          text: t(
            'forgotPassword.success',
            'If an account exists with this email, a reset link has been sent. Check your inbox.'
          ),
        });
        successMsg.style.textAlign = 'left';
        successMsg.style.marginBottom = 'var(--ps-space-4)';
        form.append(successMsg, backLink);
      } else {
        status.textContent = data?.error || t('forgotPassword.error', 'Something went wrong. Please try again.');
        status.className = 'auth-status is-error';
        busyManager.setBusy(false);
      }
    } catch (err) {
      status.textContent = t('forgotPassword.error', 'Something went wrong. Please try again.');
      status.className = 'auth-status is-error';
      busyManager.setBusy(false);
    }
  };

  btn.onclick = submit;

  email.addEventListener('keydown', (ev) => ev.key === 'Enter' && submit());

  // Button row with btn and back link
  const btnRow = h('div', { class: 'auth-btn-row' });
  btnRow.append(btn, backLink);

  form.append(email, btnRow, status);
  card.append(header, form);
  shell.append(card);
  root.append(shell);

  email.focus();
}