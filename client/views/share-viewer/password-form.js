/**
 * Password prompt component for password-protected share links.
 */

import { t } from '../../lib/ui-i18n.js';

/**
 * Render a password prompt for password-protected share links.
 * @param {Function} h - DOM helper function
 * @param {HTMLElement} shell - Container element
 * @param {string} token - Share token
 * @param {Object} shareData - Share link data
 * @param {Function} onSuccess - Callback when password is verified
 */
export function renderPasswordPrompt(h, shell, token, shareData, onSuccess) {
  shell.innerHTML = '';

  const card = h('div', { class: 'share-viewer-card' });
  const title = h('h2', { text: t('share.passwordRequired', 'Password Required') });
  const help = h('p', { class: 'help', text: t('share.passwordHelp', 'This presentation is password protected. Enter the password to continue.') });

  const form = h('form', { class: 'share-viewer-password-form' });
  const input = h('input', {
    type: 'password',
    class: 'form-input',
    placeholder: t('share.passwordPlaceholder', 'Enter password'),
    autocomplete: 'current-password',
  });
  const submitBtn = h('button', {
    type: 'submit',
    class: 'btn btn-primary',
    text: t('share.unlock', 'Unlock'),
  });
  const errorEl = h('div', { class: 'share-viewer-error', style: 'display: none;' });

  form.append(input, submitBtn);
  card.append(title, help, form, errorEl);
  shell.append(card);

  input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = input.value;

    submitBtn.disabled = true;
    submitBtn.textContent = t('share.verifying', 'Verifying...');
    errorEl.style.display = 'none';

    try {
      const resp = await fetch(`/api/share/${encodeURIComponent(token)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || t('share.passwordInvalid', 'Invalid password'));
      }

      onSuccess(data);
    } catch (err) {
      errorEl.textContent = err.message === 'invalid_password'
        ? t('share.invalidPassword', 'Invalid password')
        : err.message;
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = t('share.unlock', 'Unlock');
      input.value = '';
      input.focus();
    }
  });
}