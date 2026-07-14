/**
 * Viewer mode topbar component.
 * Simplified topbar with title, permission badge, present button, and optional comments toggle.
 */

import { createUiModeSwitcher } from '../ui-mode-switcher.js';
import { t } from '../../lib/ui-i18n.js';

function getPermissionLabel(permission) {
  if (permission === 'view') return t('viewer.permission.view', 'View only');
  if (permission === 'comment') return t('viewer.permission.comment', 'Can comment');
  return t('viewer.permission.edit', 'Edit');
}

export function createViewerTopbar({
  h,
  nav,
  pres,
  id,
  permission,
  onToggleComments,
  setCommentsBadge,
} = {}) {
  const detachers = [];

  // Back button
  const btnBack = h('button', {
    class: 'btn btn-secondary btn-icon',
    'aria-label': t('common.back', 'Back'),
    title: t('common.back', 'Back'),
    text: '\u2190',
    onclick: () => nav?.('/app'),
  });

  // Title (read-only, no edit button)
  const titleEl = h('div', {
    class: 'viewer-topbar-title',
    text: pres?.title || 'Presentation',
    title: pres?.title || 'Presentation',
  });

  // Permission badge
  const permissionBadge = h('div', {
    class: `viewer-permission-badge viewer-permission-badge--${permission}`,
    text: getPermissionLabel(permission),
  });

  // Spacer
  const spacer = h('div', { class: 'viewer-topbar-spacer' });

  // Controls container
  const controls = h('div', { class: 'viewer-topbar-controls' });

  // Comments button (only for comment permission)
  // Made prominent since commenting is the main action for these users
  if (onToggleComments) {
    // Badge is hidden by default - only shows when there are comments
    const commentsBadgeEl = h('span', { class: 'comments-badge', text: '', hidden: true });
    const btnTextEl = h('span', { text: t('viewer.addComment', 'Add Comment') });
    const btnComments = h('button', {
      class: 'btn viewer-comments-btn viewer-comments-btn--prominent',
      type: 'button',
      title: t('viewer.addComment.title', 'View and add comments'),
      'aria-label': t('viewer.addComment', 'Add Comment'),
      onclick: () => onToggleComments?.(),
    });
    btnComments.append(btnTextEl, commentsBadgeEl);

    const updateCommentsBadge = (data) => {
      const n = typeof data === 'object' ? (Number(data.count) || 0) : (Number(data) || 0);
      const hasNew = typeof data === 'object' ? Boolean(data.hasNew) : true;

      // Only show badge when there are comments (red for new, gray for seen)
      if (n > 0) {
        commentsBadgeEl.textContent = String(n);
        commentsBadgeEl.hidden = false;
        commentsBadgeEl.classList.toggle('comments-badge--seen', !hasNew);
        // Update button text when there are existing comments
        btnTextEl.textContent = t('viewer.comments', 'Comments');
      } else {
        commentsBadgeEl.hidden = true;
        btnTextEl.textContent = t('viewer.addComment', 'Add Comment');
      }
    };

    if (typeof setCommentsBadge === 'function') {
      try {
        setCommentsBadge(updateCommentsBadge);
      } catch {
        // ignore
      }
    }

    controls.append(btnComments);
  }

  // UI mode switcher
  const uiMode = createUiModeSwitcher({ h, className: 'viewer-ui-mode' });
  detachers.push(uiMode.detach);
  controls.append(uiMode.el);

  // Present button
  const btnPresent = h('button', {
    class: 'btn btn-primary',
    text: t('editor.present', 'Present'),
    onclick: () => {
      const u = new URL(`/present/${id}`, location.origin);
      if (pres?.i18n?.active === 'nl' || pres?.i18n?.active === 'en-GB') {
        u.searchParams.set('lang', pres.i18n.active);
      }
      window.open(u.pathname + u.search, '_blank', 'noopener,noreferrer');
    },
  });
  controls.append(btnPresent);

  // Assemble topbar
  const topbarEl = h('div', { class: 'viewer-topbar' }, [
    btnBack,
    titleEl,
    permissionBadge,
    spacer,
    controls,
  ]);

  const detach = () => {
    for (const d of detachers) {
      try {
        if (typeof d === 'function') d();
      } catch {
        // ignore
      }
    }
  };

  return { topbarEl, detach };
}