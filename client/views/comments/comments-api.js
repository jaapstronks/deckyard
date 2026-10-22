/**
 * Comments API client shared by the editor and viewers.
 * Handles CRUD operations for presentation comments.
 */

/**
 * Creates a comments API client for a specific presentation.
 * @param {Object} options - Configuration options
 * @param {Function} options.api - API function for making requests
 * @param {string} options.presentationId - The presentation ID to manage comments for
 * @param {() => Promise<void>} [options.beforeCreate] - Awaited before every
 *   create. The editor stores its pending edits here, so a comment on a slide
 *   added a moment ago names a slide the stored deck already holds (B567).
 * @param {string|null} [options.shareToken] - Set when the commenter is a
 *   share-link guest: listing, creating, editing and deleting then go through
 *   the guest's own routes under the token (`/api/share/:token/comments`,
 *   D228), never the signed-in routes behind the login gate. Who comments is
 *   decided here, once: the two bases take the same paths and bodies. The
 *   rest (get one, resolve, reopen, counts, mark-read) is the account's alone
 *   and stays on the deck route; a guest has no route for it.
 * @returns {Object} API methods for comment operations
 */
export function createCommentsApi({
  api,
  presentationId,
  beforeCreate,
  shareToken = null,
}) {
  const pid = presentationId;
  const deckBase = `/api/presentations/${pid}/comments`;
  const base = shareToken
    ? `/api/share/${encodeURIComponent(shareToken)}/comments`
    : deckBase;

  /**
   * One page of the deck's comments (the list-page contract, D358): pass the
   * previous page's `nextCursor` as `cursor`, with the same filters, for the
   * next one.
   * @param {{slideId?: string, status?: string, commentType?: string, limit?: number, cursor?: string|null}} [opts]
   * @returns {Promise<{comments: Object[], nextCursor: string|null, openCount: number}>}
   */
  const listComments = async (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.slideId) params.set('slideId', opts.slideId);
    if (opts.status) params.set('status', opts.status);
    if (opts.commentType) params.set('commentType', opts.commentType);
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await api(`${base}${qs}`);
    return {
      comments: resp?.comments || [],
      nextCursor: resp?.nextCursor || null,
      openCount: resp?.openCount || 0,
    };
  };

  /**
   * Every comment thread on one slide, read page by page. For the pins on a
   * slide: a pin left out is a comment that seems not to exist, so they are
   * the whole set, and one slide's threads are few. A list a person reads
   * goes through {@link listComments} and a "Load more" instead.
   * @param {string} slideId
   * @returns {Promise<Object[]>}
   */
  const listSlideComments = async (slideId) => {
    const all = [];
    let cursor = null;
    do {
      const page = await listComments({ slideId, limit: 100, cursor });
      all.push(...page.comments);
      cursor = page.nextCursor;
    } while (cursor);
    return all;
  };

  const createComment = async ({
    body,
    slideId,
    parentId,
    positionX,
    positionY,
  }) => {
    // Validate position coordinates if provided
    if (
      positionX !== undefined &&
      (typeof positionX !== 'number' || positionX < 0 || positionX > 100)
    ) {
      throw new Error('positionX must be a number between 0 and 100');
    }
    if (
      positionY !== undefined &&
      (typeof positionY !== 'number' || positionY < 0 || positionY > 100)
    ) {
      throw new Error('positionY must be a number between 0 and 100');
    }

    const payload = { body, slideId, parentId };
    if (typeof positionX === 'number' && typeof positionY === 'number') {
      payload.positionX = positionX;
      payload.positionY = positionY;
    }
    await beforeCreate?.();
    const resp = await api(base, {
      method: 'POST',
      body: payload,
    });
    return resp;
  };

  const getComment = async (commentId) => {
    const resp = await api(`${deckBase}/${commentId}`);
    return resp?.comment || null;
  };

  const updateComment = async (commentId, { body }) => {
    const resp = await api(`${base}/${commentId}`, {
      method: 'PUT',
      body: { body },
    });
    return resp;
  };

  const deleteComment = async (commentId) => {
    const resp = await api(`${base}/${commentId}`, {
      method: 'DELETE',
    });
    return resp;
  };

  const resolveComment = async (commentId) => {
    const resp = await api(`${deckBase}/${commentId}/resolve`, {
      method: 'POST',
      body: {},
    });
    return resp;
  };

  const reopenComment = async (commentId) => {
    const resp = await api(`${deckBase}/${commentId}/reopen`, {
      method: 'POST',
      body: {},
    });
    return resp;
  };

  const getCommentCounts = async () => {
    const resp = await api(`${deckBase}/counts`);
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
    const resp = await api(`${deckBase}/mark-read`, {
      method: 'POST',
      body: { commentIds },
    });
    return resp;
  };

  return {
    listComments,
    listSlideComments,
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
