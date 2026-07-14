/**
 * Guest join/verification prompt for share viewer.
 */

import { t } from '../../lib/ui-i18n.js';
import { escapeHtml } from '../../../shared/slide-types/helpers.js';

// Re-export for backwards compatibility
export { escapeHtml };

/**
 * Get human-readable guest error message.
 * @param {string} errorCode - Error code
 * @returns {string} Human-readable message
 */
export function getGuestErrorMessage(errorCode) {
  const messages = {
    rate_limited: t('share.guest.error.rateLimited', 'Too many requests. Please try again later.'),
    invalid_email: t('share.guest.error.invalidEmail', 'Please enter a valid email address.'),
    permission_denied: t('share.guest.error.permissionDenied', 'This share link does not allow commenting.'),
    share_link_not_found: t('share.guest.error.linkNotFound', 'Share link not found.'),
    share_link_expired: t('share.guest.error.linkExpired', 'This share link has expired.'),
    invalid_token: t('share.guest.error.invalidToken', 'Invalid verification link.'),
    token_expired: t('share.guest.error.tokenExpired', 'Verification link has expired. Please request a new one.'),
    share_link_revoked: t('share.guest.error.linkRevoked', 'This share link has been revoked.'),
    not_invited: t('share.guest.error.notInvited', 'This presentation requires an invitation. Please contact the author to request access.'),
  };
  return messages[errorCode] || t('share.guest.error.generic', 'Something went wrong. Please try again.');
}

/**
 * Render the guest join/verification prompt.
 * @param {Function} h - DOM helper function
 * @param {HTMLElement} shell - Container element
 * @param {string} token - Share token
 * @param {string} permission - Share link permission
 * @param {Function} onSuccess - Callback when verification email is sent
 * @param {string} [prefillEmail] - Optional email to pre-fill the input
 */
export function renderGuestJoinPrompt(h, shell, token, permission, onSuccess, prefillEmail) {
  // Create modal overlay
  const overlay = h('div', { class: 'share-viewer-modal-overlay' });
  const modal = h('div', { class: 'share-viewer-modal share-viewer-guest-modal' });

  const closeBtn = h('button', {
    class: 'share-viewer-modal-close',
    text: '\u00d7',
    'aria-label': t('common.close', 'Close'),
  });
  closeBtn.addEventListener('click', () => overlay.remove());

  const title = h('h2', { text: t('share.guest.title', 'Join the Discussion') });
  const help = h('p', {
    class: 'help',
    text: t('share.guest.help', 'Enter your email to verify your identity and start commenting.'),
  });

  const form = h('form', { class: 'share-viewer-guest-form' });

  const emailLabel = h('label', { text: t('share.guest.email', 'Email') });
  const emailInput = h('input', {
    type: 'email',
    class: 'form-input',
    placeholder: t('share.guest.emailPlaceholder', 'your@email.com'),
    autocomplete: 'email',
    required: true,
  });

  const nameLabel = h('label', { text: t('share.guest.name', 'Name (optional)') });
  const nameInput = h('input', {
    type: 'text',
    class: 'form-input',
    placeholder: t('share.guest.namePlaceholder', 'Your name'),
    autocomplete: 'name',
  });

  const submitBtn = h('button', {
    type: 'submit',
    class: 'btn btn-primary',
    text: t('share.guest.submit', 'Send Verification Email'),
  });

  const errorEl = h('div', { class: 'share-viewer-error', style: 'display: none;' });
  const successEl = h('div', { class: 'share-viewer-success', style: 'display: none;' });

  form.append(emailLabel, emailInput, nameLabel, nameInput, submitBtn);
  modal.append(closeBtn, title, help, form, errorEl, successEl);
  overlay.append(modal);
  shell.append(overlay);

  // Pre-fill email if provided
  if (prefillEmail) {
    emailInput.value = prefillEmail;
  }

  emailInput.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const name = nameInput.value.trim();

    if (!email) {
      errorEl.textContent = t('share.guest.emailRequired', 'Email is required');
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t('share.guest.sending', 'Sending...');
    errorEl.style.display = 'none';

    try {
      const resp = await fetch(`/api/share/${encodeURIComponent(token)}/guest/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(getGuestErrorMessage(data.error));
      }

      // Show success message
      form.style.display = 'none';
      successEl.innerHTML = `
        <div class="share-viewer-success-icon">✓</div>
        <h3>${t('share.guest.emailSent', 'Check your email!')}</h3>
        <p>${t('share.guest.emailSentHelp', 'We sent a verification link to <strong>{email}</strong>. Click the link to start commenting.').replace('{email}', escapeHtml(email))}</p>
        <p class="help">${t('share.guest.emailExpires', 'The link expires in 24 hours.')}</p>
      `;
      successEl.style.display = 'block';

      // Close after delay or user interaction
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.remove();
        }
      }, 8000);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = t('share.guest.submit', 'Send Verification Email');
    }
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });
}