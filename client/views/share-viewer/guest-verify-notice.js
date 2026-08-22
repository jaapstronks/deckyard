/**
 * The banner a guest sees when their e-mail verification link did not work.
 *
 * `GET /api/share/:token/guest/verify/:vtoken` answers a failure by redirecting
 * to `/s/:token?guest_error=<reason>`, so the guest lands back on the deck with
 * nothing to show for the click. That redirect had no surface at all: the
 * viewer read the code, `console.warn`ed it and carried on, and the copy that
 * once described these two reasons lived in the join-form map, which this path
 * never reaches (it was removed with #923 for exactly that reason).
 *
 * The design choice this module makes:
 *
 * 1. **A banner in the deck, not an error page.** The link is valid and the
 *    deck is readable — only the identity step failed. Replacing the deck with
 *    an error would take away something the guest is entitled to see.
 * 2. **The banner carries the re-request path.** "Request a new one" is what
 *    the expired-token copy always promised, and the join prompt *is* that
 *    path, so the button opens it rather than describing it.
 * 3. **Unless they are already signed in.** A verification token is spent on
 *    first use, so a guest who clicks the same mail twice gets `invalid_token`
 *    on the second click while holding a perfectly good session. Telling them
 *    to request a link they do not need would be the confusing answer; the
 *    banner says what actually happened instead.
 *
 * Only `invalid_token` and `token_expired` get their own copy. The other
 * reasons `verifyGuestEmail()` can return (`share_link_revoked`,
 * `share_link_expired`) mean the link itself is dead, and the viewer's own
 * validation refuses the page before this banner would ever render — they fall
 * to the generic line rather than earning copy that cannot show.
 */

import { h } from '../../lib/dom.js';
import { icon as uiIcon } from '../../lib/dom/icons.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Title and message per verification failure, keyed on the machine code the
 * redirect carries in `?guest_error=` (`server/storage/share-links/guests.js`,
 * `verifyGuestEmail`).
 * @param {string} code - The `guest_error` value.
 * @returns {{title: string, message: string}}
 */
function copyFor(code) {
  const byCode = {
    invalid_token: {
      title: t(
        'share.guestVerify.invalidTitle',
        "That verification link didn't work",
      ),
      message: t(
        'share.guestVerify.invalidMessage',
        'It has already been used, or it is no longer valid.',
      ),
    },
    token_expired: {
      title: t(
        'share.guestVerify.expiredTitle',
        'That verification link has expired',
      ),
      message: t(
        'share.guestVerify.expiredMessage',
        'Verification links stay valid for 24 hours.',
      ),
    },
  };
  return (
    byCode[code] || {
      title: t(
        'share.guestVerify.genericTitle',
        "We couldn't verify your email",
      ),
      message: t(
        'share.guestVerify.genericMessage',
        'Something went wrong on the way back from your email.',
      ),
    }
  );
}

/**
 * Build the verification-failure banner.
 *
 * @param {Object} opts
 * @param {string} opts.code - The `guest_error` code from the redirect.
 * @param {string|null} [opts.signedInAs] - Display name of the guest whose
 *   session is already live, if any. Suppresses the re-request action.
 * @param {(() => void)|null} [opts.onRequestNewLink] - Opens the join prompt.
 *   Null when this link admits no guests, which leaves the banner
 *   informational.
 * @param {() => void} [opts.onDismiss] - Called after the banner removes itself.
 * @returns {HTMLElement}
 */
export function createGuestVerifyNotice({
  code,
  signedInAs = null,
  onRequestNewLink = null,
  onDismiss = () => {},
}) {
  const { title, message } = copyFor(code);

  const notice = h('div', {
    class: 'share-viewer-notice',
    // Polite: the banner is present at first paint, so it belongs in the
    // reading order rather than interrupting it.
    role: 'status',
  });

  const body = h('div', { class: 'share-viewer-notice-body' }, [
    h('strong', { class: 'share-viewer-notice-title', text: title }),
    h('span', {
      class: 'share-viewer-notice-message',
      text: signedInAs
        ? t(
            'share.guestVerify.alreadySignedIn',
            "You're already signed in as {name}, so there's nothing left to do.",
            { name: signedInAs },
          )
        : message,
    }),
  ]);

  const actions = h('div', { class: 'share-viewer-notice-actions' });
  if (onRequestNewLink && !signedInAs) {
    const retryBtn = h('button', {
      class: 'btn btn-secondary btn-sm',
      text: t('share.guestVerify.requestNew', 'Request a new link'),
    });
    retryBtn.addEventListener('click', () => onRequestNewLink());
    actions.append(retryBtn);
  }

  const closeBtn = h('button', {
    class: 'share-viewer-notice-close',
    text: '×',
    'aria-label': t('share.guestVerify.dismiss', 'Dismiss this message'),
  });
  closeBtn.addEventListener('click', () => {
    notice.remove();
    onDismiss();
  });
  actions.append(closeBtn);

  notice.append(
    h('div', { class: 'share-viewer-notice-icon' }, [
      uiIcon('circle-alert', { size: 20 }),
    ]),
    body,
    actions,
  );
  return notice;
}
