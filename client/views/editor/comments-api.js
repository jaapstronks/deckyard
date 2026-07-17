/**
 * Comments API client for the editor.
 * Handles CRUD operations for presentation comments.
 */

/**
 * Creates a comments API client for a specific presentation.
 * @param {Object} options - Configuration options
 * @param {Function} options.api - API function for making requests
 * @param {string} options.presentationId - The presentation ID to manage comments for
 * @returns {Object} API methods for comment operations
 */
export function createCommentsApi({ api, presentationId }) {
  const pid = presentationId;

  const listComments = async (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.slideId) params.set('slideId', opts.slideId);
    if (opts.status) params.set('status', opts.status);
    if (opts.commentType) params.set('commentType', opts.commentType);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await api(`/api/presentations/${pid}/comments${qs}`);
    return {
      comments: resp?.comments || [],
      openCount: resp?.openCount || 0,
    };
  };

  const createComment = async ({ body, slideId, parentId, positionX, positionY }) => {
    // Validate position coordinates if provided
    if (positionX !== undefined && (typeof positionX !== 'number' || positionX < 0 || positionX > 100)) {
      throw new Error('positionX must be a number between 0 and 100');
    }
    if (positionY !== undefined && (typeof positionY !== 'number' || positionY < 0 || positionY > 100)) {
      throw new Error('positionY must be a number between 0 and 100');
    }

    const payload = { body, slideId, parentId };
    if (typeof positionX === 'number' && typeof positionY === 'number') {
      payload.positionX = positionX;
      payload.positionY = positionY;
    }
    const resp = await api(`/api/presentations/${pid}/comments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return resp;
  };

  const getComment = async (commentId) => {
    const resp = await api(`/api/presentations/${pid}/comments/${commentId}`);
    return resp?.comment || null;
  };

  const updateComment = async (commentId, { body }) => {
    const resp = await api(`/api/presentations/${pid}/comments/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    });
    return resp;
  };

  const deleteComment = async (commentId) => {
    const resp = await api(`/api/presentations/${pid}/comments/${commentId}`, {
      method: 'DELETE',
    });
    return resp;
  };

  const resolveComment = async (commentId) => {
    const resp = await api(`/api/presentations/${pid}/comments/${commentId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return resp;
  };

  const reopenComment = async (commentId) => {
    const resp = await api(`/api/presentations/${pid}/comments/${commentId}/reopen`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return resp;
  };

  const getCommentCounts = async () => {
    const resp = await api(`/api/presentations/${pid}/comments/counts`);
    return {
      counts: resp?.counts || {},
      total: resp?.total || 0,
    };
  };

  /**
   * Mark threads as read for the current user (batch; personal read-state,
   * nothing shared changes).
   * @param {string[]} commentIds - Top-level comment ids
   */
  const markThreadsRead = async (commentIds) => {
    const resp = await api(`/api/presentations/${pid}/comments/mark-read`, {
      method: 'POST',
      body: JSON.stringify({ commentIds }),
    });
    return resp;
  };

  return {
    listComments,
    createComment,
    getComment,
    updateComment,
    deleteComment,
    resolveComment,
    reopenComment,
    getCommentCounts,
    markThreadsRead,
  };
}