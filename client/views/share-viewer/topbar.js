import { h } from '../../lib/dom.js';
import { api } from '../../lib/api.js';
import { t } from '../../lib/ui-i18n.js';
import { createUiModeSwitcher } from '../ui-mode-switcher.js';
import { createCommentsApi } from '../editor/comments-api.js';
import { getPermissionLabel } from '../../lib/permission-labels.js';
import { renderGuestJoinPrompt } from './guest-join.js';
import { createShareViewerCommentsSection } from './viewer-comments.js';
import { createEraseMyDataButton } from '../../lib/format/analytics-erase-button.js';

/**
 * Build the share-viewer topbar: title, permission badge, guest controls
 * (comments toggle + join/identity), and the UI-mode switcher.
 *
 * When the viewer can comment and a guest is authenticated, this also creates
 * the (initially hidden) comments section and returns it so the orchestrator
 * can append it below the nav and refresh it on slide change.
 *
 * @param {object} opts
 * @param {object} opts.presentation
 * @param {object} opts.shareLink - resolved share link ({ permission, presentationId, ... }).
 * @param {object|null} opts.guestSession
 * @param {string} opts.token - share token.
 * @param {string} opts.prefillEmail - email to pre-fill in the guest join form.
 * @param {HTMLElement} opts.shell - viewer shell (guest-join prompt renders into it).
 * @param {() => string|null} opts.getCurrentSlideId - live current slide id.
 * @param {Object|null} [opts.analyticsTracker] - live tracker, for the "forget me" control.
 * @param {() => void} [opts.onAnalyticsErased] - called after the viewer erases their data.
 * @returns {{ topbar: HTMLElement, commentsSection: object|null,
 *   openJoinPrompt: (() => void)|null }} `openJoinPrompt` is the join button's
 *   own action, handed back so the verification-failure banner can offer the
 *   same path without a second copy of the prompt's wiring. Null when this
 *   link admits no guests, or when one is already signed in.
 */
export function buildShareViewerTopbar({
  presentation,
  shareLink,
  guestSession,
  token,
  prefillEmail,
  shell,
  getCurrentSlideId,
  analyticsTracker = null,
  onAnalyticsErased,
}) {
  const topbar = h('div', { class: 'share-viewer-topbar' });

  const titleEl = h('div', {
    class: 'share-viewer-title',
    text: presentation.title || 'Presentation',
  });
  const permissionBadge = h('div', {
    class: `share-viewer-permission share-viewer-permission--${shareLink.permission}`,
    text: getPermissionLabel(shareLink.permission),
  });

  const controls = h('div', { class: 'share-viewer-controls' });

  // Add guest join button if permission allows commenting.
  // Share links are only ever issued as 'view' or 'comment' (see the create
  // form in share-modal); there is no guest-editing flow, so 'edit' is not
  // handled here.
  const canComment = shareLink.permission === 'comment';

  /** @type {(() => void)|null} */
  let openJoinPrompt = null;

  // Comments toggle button (shown when guest is authenticated and can comment)
  let commentsToggleBtn = null;
  let commentsSection = null;
  let commentsApi = null;

  if (canComment && guestSession?.authenticated) {
    commentsApi = createCommentsApi({ api, presentationId: presentation.id });

    commentsToggleBtn = h('button', {
      class: 'btn btn-secondary share-viewer-comments-toggle',
      text: t('comments.title', 'Comments'),
    });

    // Create comments section (initially hidden)
    commentsSection = createShareViewerCommentsSection({
      commentsApi,
      presentation,
      guestSession,
      getCurrentSlideId,
    });

    commentsToggleBtn.addEventListener('click', () => {
      commentsSection.toggle();
      commentsToggleBtn.classList.toggle(
        'is-active',
        commentsSection.isVisible(),
      );
    });

    controls.append(commentsToggleBtn);
  }

  if (canComment) {
    const guestStatusEl = h('div', { class: 'share-viewer-guest-status' });

    if (guestSession?.authenticated) {
      // Show logged in status
      const guestName = guestSession.name || guestSession.email;
      const guestInfo = h('div', { class: 'share-viewer-guest-info' }, [
        h('span', {
          class: 'share-viewer-guest-avatar',
          text: guestName.charAt(0).toUpperCase(),
        }),
        h('span', { class: 'share-viewer-guest-name', text: guestName }),
      ]);
      guestStatusEl.append(guestInfo);
    } else {
      // Show join button
      openJoinPrompt = () => {
        renderGuestJoinPrompt(shell, token, prefillEmail);
      };
      const joinBtn = h('button', {
        class: 'btn btn-secondary share-viewer-join-btn',
        text: t('share.guest.join', 'Join discussion'),
      });
      joinBtn.addEventListener('click', () => openJoinPrompt());
      guestStatusEl.append(joinBtn);
    }

    controls.append(guestStatusEl);
  }

  // "Forget me": erase the analytics history this device has recorded. Only
  // present when a tracker is live (analytics enabled for this deck).
  const eraseBtn = createEraseMyDataButton({
    tracker: analyticsTracker,
    labels: {
      button: t('share.erase.button', 'Forget me'),
      tooltip: t(
        'share.erase.tooltip',
        'Erase the view history recorded for this device',
      ),
      confirmTitle: t('share.erase.confirmTitle', 'Forget this device?'),
      confirmMessage: t(
        'share.erase.confirmMessage',
        "This permanently erases the viewing history recorded for this device across every presentation on this site. It can't be undone.",
      ),
      confirmOk: t('share.erase.confirmOk', 'Forget me'),
      cancel: t('common.cancel', 'Cancel'),
      done: t(
        'share.erase.done',
        'Your viewing history on this device has been erased.',
      ),
      failed: t(
        'share.erase.failed',
        "Couldn't erase your data. Please try again.",
      ),
    },
    onErased: onAnalyticsErased,
  });
  if (eraseBtn) controls.append(eraseBtn);

  const uiMode = createUiModeSwitcher({ className: 'share-viewer-ui-mode' });
  controls.append(uiMode.el);

  topbar.append(titleEl, permissionBadge, controls);

  return { topbar, commentsSection, openJoinPrompt };
}
