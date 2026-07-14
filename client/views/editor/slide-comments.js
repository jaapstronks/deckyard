/**
 * Slide-specific comments section for the preview panel.
 * Shows comments for the currently selected slide in a collapsible section.
 */

import { t } from '../../lib/ui-i18n.js';
import { confirmModal } from '../../lib/modal.js';
import { formatRelativeTime } from '../../lib/format-time.js';
import { isCommentOwner, isCommentAuthor } from '../../lib/comment-authz.js';

/**
 * Creates a slide comments section component.
 * @param {Object} options - Configuration options
 * @param {Function} options.h - DOM helper function for creating elements
 * @param {Object} options.commentsApi - The comments API client
 * @param {Function} options.getSelectedSlideId - Function to get selected slide ID
 * @param {Object} options.user - Current user object
 * @param {Object} options.pres - Presentation object
 * @param {Function} [options.onJumpToSlide] - Callback when clicking slide link
 * @returns {Object} Slide comments section API
 */
export function createSlideCommentsSection({
  h,
  commentsApi,
  getSelectedSlideId,
  user,
  pres,
  onJumpToSlide,
}) {
  let expanded = false;
  let comments = [];
  let commentCount = 0;

  const section = h('div', { class: 'slide-comments-section' });
  section.style.display = 'none';

  // Always-visible quick input area (outside collapsible)
  const quickInputArea = h('div', { class: 'slide-comments-quick-input' });
  const quickInput = h('input', {
    class: 'form-input slide-comments-quick-field',
    type: 'text',
    placeholder: t('comments.quickPlaceholder', 'Add a comment to this slide...'),
  });
  const quickSubmitBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    type: 'button',
    text: t('comments.post', 'Post'),
  });
  quickSubmitBtn.addEventListener('click', () => submitQuickComment());
  quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuickComment();
    }
  });
  quickInputArea.append(quickInput, quickSubmitBtn);

  // Header (toggle for existing comments)
  const header = h('div', { class: 'slide-comments-header' });
  const headerBtn = h('button', {
    class: 'slide-comments-toggle',
    type: 'button',
  });
  const headerTitle = h('span', {
    class: 'slide-comments-title',
    text: t('comments.viewComments', 'View comments'),
  });
  const headerCount = h('span', { class: 'slide-comments-count' });
  const headerChevron = h('span', { class: 'slide-comments-chevron', text: '▼' });

  headerBtn.append(headerTitle, headerCount, headerChevron);
  headerBtn.addEventListener('click', () => toggle());
  header.append(headerBtn);

  // Body (collapsible) - just shows existing comments, no input here
  const body = h('div', { class: 'slide-comments-body' });
  body.style.display = 'none';

  // Comments list
  const list = h('div', { class: 'slide-comments-list' });

  body.append(list);
  section.append(quickInputArea, header, body);

  function updateHeaderCount() {
    if (commentCount > 0) {
      headerCount.textContent = `(${commentCount})`;
      headerCount.style.display = '';
      header.style.display = '';
    } else {
      headerCount.style.display = 'none';
      // Hide the entire header toggle when there are no comments
      header.style.display = 'none';
      // Also collapse the body if expanded
      if (expanded) collapse();
    }
  }

  function updateChevron() {
    headerChevron.textContent = expanded ? '▲' : '▼';
  }

  async function loadComments() {
    const slideId = getSelectedSlideId?.();
    if (!slideId) {
      comments = [];
      commentCount = 0;
      updateHeaderCount();
      renderComments();
      return;
    }

    try {
      const result = await commentsApi.listComments({ slideId });
      comments = result.comments || [];
      commentCount = comments.length;
      updateHeaderCount();
      renderComments();
    } catch (err) {
      console.error('Failed to load slide comments:', err);
    }
  }

  function renderComments() {
    list.innerHTML = '';

    if (comments.length === 0) {
      const emptyEl = h('div', {
        class: 'slide-comments-empty',
        text: t('comments.empty.slide', 'No comments on this slide yet.'),
      });
      list.append(emptyEl);
      return;
    }

    for (const comment of comments) {
      const threadEl = renderCommentThread(comment);
      list.append(threadEl);
    }
  }

  function renderCommentThread(comment) {
    const threadEl = h('div', { class: 'slide-comment-thread' });

    const mainEl = renderSingleComment(comment, false, threadEl);
    threadEl.append(mainEl);

    if (comment.replies && comment.replies.length > 0) {
      const repliesEl = h('div', { class: 'slide-comment-replies' });
      for (const reply of comment.replies) {
        const replyEl = renderSingleComment(reply, true);
        repliesEl.append(replyEl);
      }
      threadEl.append(repliesEl);
    }

    return threadEl;
  }

  function renderSingleComment(comment, isReply, threadEl = null) {
    const el = h('div', {
      class: `slide-comment ${isReply ? 'is-reply' : ''} ${comment.status === 'resolved' ? 'is-resolved' : ''}`,
      'data-comment-id': comment.id,
    });

    // Header
    const headerEl = h('div', { class: 'slide-comment-header' });
    const authorEl = h('span', {
      class: 'slide-comment-author',
      text: comment.authorName || comment.authorEmail || t('comments.unknownAuthor', 'Unknown'),
    });
    const timeEl = h('span', {
      class: 'slide-comment-time',
      text: formatCommentTime(comment.createdAt),
    });
    headerEl.append(authorEl, timeEl);

    // Body
    const bodyEl = h('div', {
      class: 'slide-comment-body',
      text: comment.body,
    });

    // Actions
    const actionsEl = h('div', { class: 'slide-comment-actions' });

    // Reply button (top-level only)
    if (!isReply && threadEl) {
      const replyBtn = h('button', {
        class: 'btn btn-xs btn-secondary',
        type: 'button',
        text: t('comments.reply', 'Reply'),
        onclick: () => {
          let replyInput = threadEl.querySelector('.slide-comment-reply-input');
          if (replyInput) {
            replyInput.remove();
          } else {
            replyInput = createReplyInput(comment.id);
            threadEl.append(replyInput);
            replyInput.querySelector('textarea')?.focus();
          }
        },
      });
      actionsEl.append(replyBtn);
    }

    // Resolve/Reopen (only for owner)
    if (isOwner() && !isReply) {
      if (comment.status === 'open') {
        const resolveBtn = h('button', {
          class: 'btn btn-xs btn-secondary',
          type: 'button',
          text: t('comments.resolve', 'Resolve'),
          onclick: () => resolveCommentAction(comment.id),
        });
        actionsEl.append(resolveBtn);
      } else {
        const reopenBtn = h('button', {
          class: 'btn btn-xs btn-secondary',
          type: 'button',
          text: t('comments.reopen', 'Reopen'),
          onclick: () => reopenCommentAction(comment.id),
        });
        actionsEl.append(reopenBtn);
      }
    }

    // Delete (only for author)
    if (isAuthor(comment)) {
      const deleteBtn = h('button', {
        class: 'btn btn-xs btn-danger',
        type: 'button',
        text: t('comments.delete', 'Delete'),
        onclick: () => deleteCommentAction(comment.id),
      });
      actionsEl.append(deleteBtn);
    }

    el.append(headerEl, bodyEl, actionsEl);
    return el;
  }

  function createReplyInput(parentId) {
    const container = h('div', { class: 'slide-comment-reply-input' });
    const ta = h('textarea', {
      class: 'form-input',
      placeholder: t('comments.replyPlaceholder', 'Reply...'),
      rows: 1,
    });
    const btn = h('button', {
      class: 'btn btn-xs btn-primary',
      type: 'button',
      text: t('comments.reply', 'Reply'),
      onclick: async () => {
        const body = ta.value.trim();
        if (!body) return;
        try {
          btn.disabled = true;
          await commentsApi.createComment({
            body,
            parentId,
            slideId: getSelectedSlideId?.() || null,
          });
          ta.value = '';
          loadComments();
        } catch (err) {
          console.error('Failed to post reply:', err);
        } finally {
          btn.disabled = false;
        }
      },
    });
    container.append(ta, btn);
    return container;
  }

  async function submitQuickComment() {
    const body = quickInput.value.trim();
    if (!body) return;

    const slideId = getSelectedSlideId?.();
    if (!slideId) return;

    try {
      quickSubmitBtn.disabled = true;
      await commentsApi.createComment({
        body,
        slideId,
      });
      quickInput.value = '';
      loadComments();
      // Auto-expand to show the new comment
      if (!expanded) expand();
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      quickSubmitBtn.disabled = false;
    }
  }

  async function resolveCommentAction(commentId) {
    try {
      await commentsApi.resolveComment(commentId);
      loadComments();
    } catch (err) {
      console.error('Failed to resolve comment:', err);
    }
  }

  async function reopenCommentAction(commentId) {
    try {
      await commentsApi.reopenComment(commentId);
      loadComments();
    } catch (err) {
      console.error('Failed to reopen comment:', err);
    }
  }

  async function deleteCommentAction(commentId) {
    if (!(await confirmModal(h, document.body, {
      title: t('comments.delete', 'Delete'),
      message: t('comments.deleteConfirm', 'Delete this comment?'),
      confirmLabel: t('comments.delete', 'Delete'),
      danger: true,
    }))) return;
    try {
      await commentsApi.deleteComment(commentId);
      loadComments();
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  }

  function isOwner() {
    return isCommentOwner(user, pres);
  }

  function isAuthor(comment) {
    return isCommentAuthor(user, comment);
  }

  function formatCommentTime(isoString) {
    return formatRelativeTime(isoString, t);
  }

  function show() {
    section.style.display = '';
  }

  function hide() {
    section.style.display = 'none';
  }

  function expand() {
    expanded = true;
    body.style.display = '';
    updateChevron();
    loadComments();
  }

  function collapse() {
    expanded = false;
    body.style.display = 'none';
    updateChevron();
  }

  function toggle() {
    if (expanded) collapse();
    else expand();
  }

  function isExpanded() {
    return expanded;
  }

  function refresh() {
    if (expanded) loadComments();
    else {
      // Just update the count even when collapsed
      loadComments();
    }
  }

  function setCommentCount(count) {
    commentCount = count || 0;
    updateHeaderCount();
  }

  function highlightComment(commentId) {
    // Expand if not already expanded
    if (!expanded) {
      expand();
    }

    // Wait for render, then find and highlight the comment
    requestAnimationFrame(() => {
      const commentEl = list.querySelector(`[data-comment-id="${commentId}"]`);
      if (commentEl) {
        // Scroll into view
        commentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Add highlight effect
        commentEl.classList.add('is-highlighted');
        setTimeout(() => {
          commentEl.classList.remove('is-highlighted');
        }, 2000);
      }
    });
  }

  // Initialize
  updateHeaderCount();
  updateChevron();

  return {
    el: section,
    show,
    hide,
    expand,
    collapse,
    toggle,
    isExpanded,
    refresh,
    loadComments,
    setCommentCount,
    highlightComment,
  };
}