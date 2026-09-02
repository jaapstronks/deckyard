/**
 * Password prompt component for password-protected share links.
 */

import { api } from '../../lib/api.js';
import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom.js';
import { createInlineError } from '../../lib/dom/inline-error.js';

/**
 * Render a password prompt for password-protected share links.
 * @param {HTMLElement} shell - Container element
 * @param {string} token - Share token
 * @param {Object} shareData - Share link data
 * @param {Function} onSuccess - Callback when password is verified
 */
export function renderPasswordPrompt(shell, token, shareData, onSuccess) {
  shell.innerHTML = '';

  const card = h('div', { class: 'share-viewer-card' });
  const title = h('h2', {
    text: t('share.passwordRequired', 'Password Required'),
  });
  const help = h('p', {
    class: 'help',
    text: t(
      'share.passwordHelp',
      'This presentation is password protected. Enter the password to continue.',
    ),
  });

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
  const refusal = createInlineError({ callout: true });

  form.append(input, submitBtn);
  card.append(title, help, form, refusal.el);
  shell.append(card);

  input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = input.value;

    submitBtn.disabled = true;
    submitBtn.textContent = t('share.verifying', 'Verifying…');
    refusal.clear();

    try {
      const data = await api(`/api/share/${encodeURIComponent(token)}/verify`, {
        method: 'POST',
        body: { password },
      });

      onSuccess(data);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = t('share.unlock', 'Unlock');
      input.value = '';
      // The helper lands focus back on the field it names.
      refusal.show(
        err.code === 'invalid_password'
          ? t('share.invalidPassword', 'Invalid password')
          : err.message,
        { control: input },
      );
    }
  });
}
