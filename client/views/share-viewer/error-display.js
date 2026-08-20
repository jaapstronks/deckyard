/**
 * Error display component for share viewer.
 */

import { t } from '../../lib/ui-i18n.js';
import { icon as uiIcon } from '../../lib/dom/icons.js';

/**
 * Render an error state.
 * @param {Function} h - DOM helper function
 * @param {HTMLElement} shell - Container element
 * @param {string} errorCode - Error code or message
 * @param {Object} [errorData] - Additional error data
 * @param {string} [errorData.message] - Custom revocation message
 * @param {string} [errorData.presentationTitle] - Presentation title
 */
export function renderError(h, shell, errorCode, errorData = {}) {
  shell.innerHTML = '';

  const card = h('div', {
    class: 'share-viewer-card share-viewer-card--error',
  });

  const errorMessages = {
    not_found: {
      title: t('share.error.notFound', 'Link Not Found'),
      message: t(
        'share.error.notFoundHelp',
        'This share link does not exist or has been removed.',
      ),
    },
    revoked: {
      title: t('share.error.revoked', 'Access Revoked'),
      message: t(
        'share.error.revokedHelp',
        'This share link has been revoked by the owner.',
      ),
    },
    expired: {
      title: t('share.error.expired', 'Link Expired'),
      message: t('share.error.expiredHelp', 'This share link has expired.'),
    },
    max_uses_exceeded: {
      title: t('share.error.maxUses', 'Link Limit Reached'),
      message: t(
        'share.error.maxUsesHelp',
        'This share link has reached its maximum number of uses.',
      ),
    },
    invalid_password: {
      title: t('share.error.invalidPassword', 'Invalid Password'),
      message: t(
        'share.error.invalidPasswordHelp',
        'The password you entered is incorrect.',
      ),
    },
  };

  const errorInfo = errorMessages[errorCode] || {
    title: t('share.error.generic', 'Error'),
    message:
      errorCode ||
      t(
        'share.error.genericHelp',
        'Something went wrong while loading this share link.',
      ),
  };

  const icon = h('div', { class: 'share-viewer-error-icon' }, [
    uiIcon('circle-alert', { size: 48 }),
  ]);
  const title = h('h2', { text: errorInfo.title });

  // Show presentation title if available
  if (errorData.presentationTitle) {
    const presTitle = h('div', {
      class: 'share-viewer-error-presentation',
      text: `"${errorData.presentationTitle}"`,
    });
    card.append(icon, title, presTitle);
  } else {
    card.append(icon, title);
  }

  const message = h('p', { class: 'help', text: errorInfo.message });
  card.append(message);

  // Show custom revocation message in blockquote if provided
  if (errorCode === 'revoked' && errorData.message) {
    const blockquote = h('blockquote', {
      class: 'share-viewer-revocation-message',
    });
    const messageText = h('p', { text: errorData.message });
    blockquote.append(messageText);
    card.append(blockquote);
  }

  shell.append(card);
}
