/**
 * The share viewer's dead ends: a link that cannot be opened (not found,
 * revoked, expired, used up, wrong password) and the generic load failure.
 *
 * A whole-page state, so it renders through the shared `createPageUnavailable`
 * factory rather than a card of its own (B213). No way-back button: an
 * anonymous visitor holding a share link has nowhere in the app to go.
 */

import { t } from '../../lib/ui-i18n.js';
import { createPageUnavailable } from '../../lib/dom/page-unavailable.js';
import { h } from '../../lib/dom.js';

/**
 * Render an error state.
 * @param {HTMLElement} shell - Container element
 * @param {string} errorCode - Error code or message
 * @param {Object} [errorData] - Additional error data
 * @param {string} [errorData.message] - Custom revocation message
 * @param {string} [errorData.presentationTitle] - Presentation title
 */
export function renderError(shell, errorCode, errorData = {}) {
  shell.innerHTML = '';

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

  // The owner's own words on a revoked link, kept apart from our copy.
  let extra = null;
  if (errorCode === 'revoked' && errorData.message) {
    extra = h('blockquote', { class: 'share-viewer-revocation-message' }, [
      h('p', { text: errorData.message }),
    ]);
  }

  shell.append(
    createPageUnavailable({
      icon: 'circle-alert',
      title: errorInfo.title,
      subtitle: errorData.presentationTitle
        ? `"${errorData.presentationTitle}"`
        : null,
      message: errorInfo.message,
      extra,
    }),
  );
}
