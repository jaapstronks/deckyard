/**
 * Comment rendering factory functions.
 * Extracted from comments-panel.js for better modularity.
 */

import { t } from '../../lib/ui-i18n.js';
import { DREAMBOT_EMAIL } from '../../../shared/constants/ai.js';

/**
 * Creates comment rendering functions with bound dependencies.
 * @param {Object} deps - Dependencies
 * @param {Function} deps.h - DOM helper function
 * @param {Object} deps.filter - Current filter state
 * @param {Function} deps.getSlideNumber - Function to get slide number from ID
 * @param {Function} deps.formatTime - Time formatting function
 * @param {Function} deps.isOwner - Check if current user is owner
 * @param {Function} deps.isAuthor - Check if current user is author of a comment
 * @param {Function} deps.onJumpToSlide - Callback when clicking slide link
 * @param {Function} deps.onReply - Callback when replying
 * @param {Function} deps.onResolve - Callback to resolve comment
 * @param {Function} deps.onReopen - Callback to reopen comment
 * @param {Function} deps.onDelete - Callback to delete comment
 * @param {Function} deps.onDismiss - Callback to dismiss AI suggestion
 * @param {Function} deps.onApply - Callback to apply AI suggestion
 * @returns {Object} Rendering functions
 */
export function createCommentRenderers({
  h,
  filter,
  getSlideNumber,
  formatTime,
  isOwner,
  isAuthor,
  onJumpToSlide,
  onReply,
  onResolve,
  onReopen,
  onDelete,
  onDismiss,
  onApply,
}) {
  /**
   * Render the comment list (empty state or comments).
   */
  function renderCommentList(listEl, comments) {
    listEl.innerHTML = '';

    if (comments.length === 0) {
      const emptyEl = h('div', {
        class: 'comments-empty',
        text: filter.status === 'resolved'
          ? t('comments.empty.resolved', 'No resolved comments')
          : t('comments.empty.none', 'No comments yet. Be the first to add one!'),
      });
      listEl.append(emptyEl);
      return;
    }

    for (const comment of comments) {
      const threadEl = renderCommentThread(comment);
      listEl.append(threadEl);
    }
  }

  /**
   * Render a comment thread (main comment + replies).
   */
  function renderCommentThread(comment) {
    const threadEl = h('div', { class: 'comment-thread' });
    const mainComment = renderComment(comment, false, threadEl);
    threadEl.append(mainComment);

    // Render replies
    if (comment.replies && comment.replies.length > 0) {
      const repliesEl = h('div', { class: 'comment-replies' });
      for (const reply of comment.replies) {
        const replyEl = renderComment(reply, true);
        repliesEl.append(replyEl);
      }
      threadEl.append(repliesEl);
    }

    return threadEl;
  }

  /**
   * Render a single comment.
   */
  function renderComment(comment, isReply, threadEl = null) {
    const isAiSuggestion = comment.commentType === 'ai-suggestion' || comment.authorEmail === DREAMBOT_EMAIL;
    const isDismissed = comment.status === 'dismissed';
    const hasProposedSlide = !!(comment.proposedSlide && comment.proposedSlide.type);

    const commentEl = h('div', {
      class: `comment-item ${isReply ? 'comment-reply' : ''} ${comment.status === 'resolved' || isDismissed ? 'comment-resolved' : ''} ${isAiSuggestion ? 'is-ai-suggestion' : ''}`,
    });

    // Header with author, timestamp, and category badge for AI suggestions
    const headerEl = h('div', { class: 'comment-item-header' });
    const authorEl = h('span', {
      class: `comment-author ${isAiSuggestion ? 'comment-author-ai' : ''}`,
      text: isAiSuggestion ? t('comments.aiAuthor', 'AI Assistant') : (comment.authorName || comment.authorEmail || t('comments.unknownAuthor', 'Unknown')),
    });
    const timeEl = h('span', {
      class: 'comment-time',
      text: formatTime(comment.createdAt),
    });
    headerEl.append(authorEl, timeEl);

    // Category badge for AI suggestions
    if (isAiSuggestion && comment.suggestionCategory) {
      const categoryBadge = h('span', {
        class: `comment-category-badge comment-category-${comment.suggestionCategory}`,
        text: comment.suggestionCategory,
      });
      headerEl.append(categoryBadge);
    }

    // Add slide link for top-level comments with slideId (when not filtering by slide)
    if (!isReply && comment.slideId && !filter.slideId) {
      const slideNum = getSlideNumber(comment.slideId);
      if (slideNum) {
        const slideLink = h('button', {
          class: 'comment-slide-link',
          type: 'button',
          text: t('comments.slideLink', 'Slide {num}', { num: slideNum }),
          title: t('comments.jumpToSlide', 'Jump to slide {num}', { num: slideNum }),
        });
        slideLink.addEventListener('click', (e) => {
          e.stopPropagation();
          onJumpToSlide?.(comment.slideId);
        });
        headerEl.append(slideLink);
      }
    }

    // Body
    const bodyEl = h('div', {
      class: 'comment-body',
      text: comment.body,
    });

    // Actions row
    const actionsEl = h('div', { class: 'comment-actions' });

    // AI suggestion-specific actions
    if (isAiSuggestion && !isReply && comment.status === 'open' && isOwner()) {
      // Add Slide button for actionable suggestions
      if (hasProposedSlide) {
        const addSlideBtn = h('button', {
          class: 'btn btn-xs btn-primary',
          type: 'button',
          text: t('comments.addSlide', 'Add Slide'),
          onclick: () => onApply?.(comment),
        });
        actionsEl.append(addSlideBtn);
      }

      // Dismiss button for all AI suggestions
      const dismissBtn = h('button', {
        class: 'btn btn-xs btn-secondary',
        type: 'button',
        text: t('comments.dismiss', 'Dismiss'),
        onclick: () => onDismiss?.(comment.id),
      });
      actionsEl.append(dismissBtn);
    } else {
      // Regular comment actions

      // Reply button (only for top-level comments)
      if (!isReply && threadEl) {
        const replyBtn = h('button', {
          class: 'btn btn-xs btn-secondary',
          type: 'button',
          text: t('comments.reply', 'Reply'),
          onclick: () => {
            // Toggle reply input
            let replyInput = threadEl.querySelector('.comment-reply-input');
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

      // Resolve/Reopen (only for owners, top-level only)
      if (isOwner() && !isReply) {
        if (comment.status === 'open') {
          const resolveBtn = h('button', {
            class: 'btn btn-xs btn-secondary',
            type: 'button',
            text: t('comments.resolve', 'Resolve'),
            onclick: () => onResolve?.(comment.id),
          });
          actionsEl.append(resolveBtn);
        } else if (comment.status !== 'dismissed') {
          const reopenBtn = h('button', {
            class: 'btn btn-xs btn-secondary',
            type: 'button',
            text: t('comments.reopen', 'Reopen'),
            onclick: () => onReopen?.(comment.id),
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
          onclick: () => onDelete?.(comment.id),
        });
        actionsEl.append(deleteBtn);
      }
    }

    commentEl.append(headerEl, bodyEl, actionsEl);
    return commentEl;
  }

  /**
   * Create a reply input box.
   */
  function createReplyInput(parentId) {
    const container = h('div', { class: 'comment-reply-input' });
    const textarea = h('textarea', {
      class: 'comment-reply-textarea',
      placeholder: t('comments.replyPlaceholder', 'Reply...'),
      rows: 1,
    });

    const submitReply = () => {
      const body = textarea.value.trim();
      if (!body) return;
      onReply?.(parentId, body, textarea);
    };

    // Enter to send, Shift+Enter for newline
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitReply();
      }
    });

    const submitBtn = h('button', {
      class: 'btn btn-xs btn-primary',
      type: 'button',
      text: t('comments.reply', 'Reply'),
      onclick: submitReply,
    });
    container.append(textarea, submitBtn);
    return container;
  }

  return {
    renderCommentList,
    renderCommentThread,
    renderComment,
    createReplyInput,
  };
}