/**
 * Password prompt component for password-protected share links.
 */

import { api } from '../../lib/api.js';
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
      const data = await api(`/api/share/${encodeURIComponent(token)}/verify`, {
        method: 'POST',
        body: { password },
      });

      onSuccess(data);
    } catch (err) {
      errorEl.textContent = err.code === 'invalid_password'
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