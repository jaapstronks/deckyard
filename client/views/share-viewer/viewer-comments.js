/**
 * Comments section for share viewer.
 */

import { t } from '../../lib/ui-i18n.js';
import { confirmModal } from '../../lib/modal.js';
import { formatRelativeTime } from '../../lib/format-time.js';
import { isGuestCommentAuthor } from '../../lib/comment-authz.js';

/**
 * Create a comments section for the share viewer.
 * @param {Object} options - Configuration options
 * @param {Function} options.h - DOM helper function for creating elements
 * @param {Object} options.commentsApi - The comments API client
 * @param {Object} options.presentation - The presentation object
 * @param {Object} options.guestSession - The guest session object
 * @param {Function} options.getCurrentSlideId - Function to get current slide ID
 * @returns {Object} Comments section API with el, toggle, isVisible, refresh
 */
export function createShareViewerCommentsSection({
  h,
  commentsApi,
  presentation,
  guestSession,
  getCurrentSlideId,
}) {
  let visible = false;
  let comments = [];
  let filter = 'current'; // 'current' or 'all'

  const section = h('div', { class: 'share-viewer-comments-section' });
  section.style.display = 'none';

  // Header
  const header = h('div', { class: 'share-viewer-comments-header' });
  const headerTitle = h('h3', { text: t('comments.title', 'Comments') });

  const filterBtns = h('div', { class: 'share-viewer-comments-filter' });
  const filterCurrentBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    type: 'button',
    text: t('comments.filter.thisSlide', 'This slide'),
    onclick: () => setFilter('current'),
  });
  const filterAllBtn = h('button', {
    class: 'btn btn-sm btn-secondary',
    type: 'button',
    text: t('comments.filter.all', 'All slides'),
    onclick: () => setFilter('all'),
  });
  filterBtns.append(filterCurrentBtn, filterAllBtn);

  const closeBtn = h('button', {
    class: 'btn btn-icon share-viewer-comments-close',
    type: 'button',
    text: '×',
    onclick: () => hide(),
  });

  header.append(headerTitle, filterBtns, closeBtn);

  // Comments list
  const list = h('div', { class: 'share-viewer-comments-list' });

  // Input area
  const inputArea = h('div', { class: 'share-viewer-comments-input' });
  const textarea = h('textarea', {
    class: 'form-input',
    placeholder: t('comments.addPlaceholder', 'Add a comment...'),
    rows: 2,
  });
  const submitBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    type: 'button',
    text: t('comments.post', 'Post'),
    onclick: () => submitComment(),
  });
  const inputControls = h('div', { class: 'share-viewer-comments-input-controls' });
  inputControls.append(submitBtn);
  inputArea.append(textarea, inputControls);

  section.append(header, list, inputArea);

  function updateFilterButtons() {
    filterCurrentBtn.className = `btn btn-sm ${filter === 'current' ? 'btn-primary' : 'btn-secondary'}`;
    filterAllBtn.className = `btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`;
  }

  function setFilter(newFilter) {
    filter = newFilter;
    updateFilterButtons();
    loadComments();
  }

  async function loadComments() {
    try {
      const opts = {};
      if (filter === 'current') {
        const slideId = getCurrentSlideId?.();
        if (slideId) opts.slideId = slideId;
      }
      const result = await commentsApi.listComments(opts);
      comments = result.comments || [];
      renderComments();
    } catch (err) {
      list.innerHTML = '';
      list.append(h('div', {
        class: 'share-viewer-comments-error',
        text: t('comments.error.loadFailed', 'Failed to load comments'),
      }));
    }
  }

  function renderComments() {
    list.innerHTML = '';

    if (comments.length === 0) {
      const emptyEl = h('div', {
        class: 'share-viewer-comments-empty',
        text: t('comments.empty.none', 'No comments yet. Be the first to add one!'),
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
    const threadEl = h('div', { class: 'share-viewer-comment-thread' });

    // Main comment
    const mainEl = renderSingleComment(comment, false, threadEl);
    threadEl.append(mainEl);

    // Replies
    if (comment.replies && comment.replies.length > 0) {
      const repliesEl = h('div', { class: 'share-viewer-comment-replies' });
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
      class: `share-viewer-comment ${isReply ? 'is-reply' : ''} ${comment.status === 'resolved' ? 'is-resolved' : ''}`,
    });

    // Header
    const headerEl = h('div', { class: 'share-viewer-comment-header' });
    const authorEl = h('span', {
      class: 'share-viewer-comment-author',
      text: comment.authorName || comment.authorEmail || t('comments.unknownAuthor', 'Unknown'),
    });
    const timeEl = h('span', {
      class: 'share-viewer-comment-time',
      text: formatCommentTime(comment.createdAt),
    });
    headerEl.append(authorEl, timeEl);

    // Body
    const bodyEl = h('div', {
      class: 'share-viewer-comment-body',
      text: comment.body,
    });

    // Actions
    const actionsEl = h('div', { class: 'share-viewer-comment-actions' });

    // Reply button (top-level only)
    if (!isReply && threadEl) {
      const replyBtn = h('button', {
        class: 'btn btn-xs btn-secondary',
        type: 'button',
        text: t('comments.reply', 'Reply'),
        onclick: () => {
          let replyInput = threadEl.querySelector('.share-viewer-comment-reply-input');
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

    // Delete button (only for own comments)
    if (isOwnComment(comment)) {
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
    const container = h('div', { class: 'share-viewer-comment-reply-input' });
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
            slideId: getCurrentSlideId?.() || null,
          });
          ta.value = '';
          loadComments();
        } catch (err) {
          // Show inline error
          console.error('Failed to post reply:', err);
        } finally {
          btn.disabled = false;
        }
      },
    });
    container.append(ta, btn);
    return container;
  }

  async function submitComment() {
    const body = textarea.value.trim();
    if (!body) return;

    try {
      submitBtn.disabled = true;
      await commentsApi.createComment({
        body,
        slideId: getCurrentSlideId?.() || null,
      });
      textarea.value = '';
      loadComments();
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      submitBtn.disabled = false;
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

  function isOwnComment(comment) {
    return isGuestCommentAuthor(guestSession, comment);
  }

  function formatCommentTime(isoString) {
    return formatRelativeTime(isoString, t);
  }

  function show() {
    visible = true;
    section.style.display = '';
    loadComments();
  }

  function hide() {
    visible = false;
    section.style.display = 'none';
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  function isVisible() {
    return visible;
  }

  function refresh() {
    if (visible) loadComments();
  }

  return {
    el: section,
    show,
    hide,
    toggle,
    isVisible,
    refresh,
  };
}