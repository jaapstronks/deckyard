/**
 * Comment action factory functions.
 * Extracted from comments-panel.js for better modularity.
 */

import { h } from '../../lib/dom.js';
import { confirmModal } from '../../lib/dom/modal.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Creates comment action handlers with bound dependencies.
 * @param {Object} deps - Dependencies
 * @param {Function} deps.api - API function for making requests
 * @param {Object} deps.commentsApi - Comments API wrapper
 * @param {string} deps.presentationId - The presentation ID
 * @param {Object} deps.pres - The presentation object
 * @param {Object} [deps.toast] - Toast notification handler
 * @param {Function} deps.loadComments - Function to reload comments
 * @returns {Object} Action handlers
 */
export function createCommentActions({
  api,
  commentsApi,
  presentationId,
  pres,
  toast,
  loadComments,
}) {
  /**
   * Resolve a comment.
   */
  async function resolveComment(commentId) {
    try {
      await commentsApi.resolveComment(commentId);
      loadComments();
    } catch (err) {
      toast?.error?.(t('comments.error.resolveFailed', 'Failed to resolve comment'));
    }
  }

  /**
   * Reopen a resolved comment.
   */
  async function reopenComment(commentId) {
    try {
      await commentsApi.reopenComment(commentId);
      loadComments();
    } catch (err) {
      toast?.error?.(t('comments.error.reopenFailed', 'Failed to reopen comment'));
    }
  }

  /**
   * Delete a comment.
   */
  async function deleteComment(commentId) {
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
      toast?.error?.(t('comments.error.deleteFailed', 'Failed to delete comment'));
    }
  }

  /**
   * Dismiss an AI suggestion.
   */
  async function dismissComment(commentId) {
    try {
      await api(`/api/presentations/${presentationId}/comments/${commentId}/dismiss`, {
        method: 'POST',
      });
      loadComments();
      toast?.success?.(t('comments.dismissed', 'Suggestion dismissed'));
    } catch (err) {
      toast?.error?.(t('comments.error.dismissFailed', 'Failed to dismiss suggestion'));
    }
  }

  /**
   * Apply an AI suggestion (add proposed slide).
   */
  async function applySuggestion(comment) {
    try {
      const result = await api(`/api/presentations/${presentationId}/comments/${comment.id}/apply`, {
        method: 'POST',
      });

      if (result.ok) {
        loadComments();
        toast?.success?.(t('comments.slideAdded', 'New slide added after slide {num}', {
          num: String(result.originalSlideIndex + 1),
        }));

        // Show follow-up prompt to delete original slide
        const slideNum = result.originalSlideIndex + 1;
        const shouldDelete = await confirmModal(h, document.body, {
          title: t('comments.deleteOriginal', 'Delete original slide'),
          message: t('comments.deleteOriginalPrompt',
            'New slide added. Do you want to delete the original slide {num}?',
            { num: String(slideNum) }
          ),
          confirmLabel: t('common.delete', 'Delete'),
          danger: true,
        });

        if (shouldDelete && result.originalSlideId) {
          // Delete the original slide
          const slideIndex = pres.slides?.findIndex(s => s?.id === result.originalSlideId);
          if (slideIndex >= 0) {
            pres.slides.splice(slideIndex, 1);
            toast?.success?.(t('comments.originalDeleted', 'Original slide deleted'));
          }
        }
      }
    } catch (err) {
      toast?.error?.(t('comments.error.applyFailed', 'Failed to apply suggestion'));
    }
  }

  return {
    resolveComment,
    reopenComment,
    deleteComment,
    dismissComment,
    applySuggestion,
  };
}