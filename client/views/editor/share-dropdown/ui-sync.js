/**
 * Share dropdown UI synchronization.
 */

import { t } from '../../../lib/ui-i18n.js';

/**
 * Create the syncShareUi function.
 * @param {Object} options
 * @returns {Function} syncShareUi function
 */
export function createSyncShareUi({
  h,
  pres,
  isAdmin,
  notionAvailable,
  summaryLabel,
  shareSummary,
  publishItem,
  unpublishItem,
  moveToPrivateItem,
  notionPublishItem,
}) {
  return function syncShareUi() {
    const isPublished = !!(typeof pres?.published?.id === 'string' && pres.published.id);
    const isWorkspaceScope = String(pres?.scope || 'private') === 'workspace';

    unpublishItem.disabled = !isPublished;
    publishItem.textContent = isPublished
      ? t('editor.publish.manage', 'Manage published...')
      : t('editor.publish.publish', 'Publish');

    // Show "Move to private" only for admins when presentation is in workspace scope
    const showMoveToPrivate = isAdmin && isWorkspaceScope;
    moveToPrivateItem.style.display = showMoveToPrivate ? '' : 'none';

    // Show Notion item only when applicable
    const hasNotionSource = !!(typeof pres?.notionSourcePageId === 'string' && pres.notionSourcePageId);
    const showNotionPublish = notionAvailable() && hasNotionSource && isPublished;
    notionPublishItem.style.display = showNotionPublish ? '' : 'none';

    // Update summary label to show published state
    summaryLabel.textContent = t('editor.share.button', 'Share');
    shareSummary.classList.toggle('btn-published', isPublished);

    // Add/remove published indicator dot
    try {
      const existingDot = shareSummary.querySelector('.live-dot');
      if (isPublished && !existingDot) {
        shareSummary.insertBefore(
          h('span', { class: 'live-dot', 'aria-hidden': 'true', text: '●' }),
          summaryLabel
        );
      } else if (!isPublished && existingDot) {
        existingDot.remove();
      }
    } catch {
      // ignore
    }
  };
}
