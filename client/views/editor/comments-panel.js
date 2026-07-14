/**
 * Comments panel for the editor.
 * Displays slide comments and allows users to add, reply, and resolve.
 */

import { createCommentsApi } from './comments-api.js';
import { t } from '../../lib/ui-i18n.js';
import { formatRelativeTime } from '../../lib/format-time.js';
import { isCommentOwner, isCommentAuthor } from '../../lib/comment-authz.js';
import { storage } from '../../lib/storage.js';
import { createCommentRenderers } from './comments-panel-renderers.js';
import { createCommentActions } from './comments-panel-actions.js';
import { createCommentSSE } from './comments-panel-sse.js';

/**
 * Creates a comments panel component for the editor.
 * @param {Object} options - Configuration options
 * @param {Function} options.h - DOM helper function for creating elements
 * @param {Function} options.api - API function for making requests
 * @param {Object} [options.toast] - Toast notification handler
 * @param {string} options.presentationId - The presentation ID
 * @param {Object} options.pres - The presentation object
 * @param {Object} options.user - The current user object
 * @param {Function} [options.getSelectedSlideId] - Function to get the currently selected slide ID
 * @param {Function} [options.onCommentCountChange] - Callback when open comment count changes
 * @param {Function} [options.onSlideCommentCountsChange] - Callback when per-slide comment counts change
 * @param {Function} [options.onJumpToSlide] - Callback when clicking a slide link (receives slideId)
 * @returns {Object} Panel API with panelEl, show, hide, toggle, refresh, and other methods
 */
export function createCommentsPanel({
  h,
  api,
  toast,
  presentationId,
  pres,
  user,
  getSelectedSlideId,
  onCommentCountChange,
  onSlideCommentCountsChange,
  onJumpToSlide,
}) {
  const commentsApi = createCommentsApi({ api, presentationId });

  // State
  let comments = [];
  let openCount = 0;
  let slideCommentCounts = {};
  let filter = { slideId: null, status: 'open', commentType: null };
  let isVisible = false;

  // Seen state tracking (for badge color)
  const SEEN_COUNT_KEY = `comments_seen_${presentationId}`;
  let lastSeenCount = Number(storage.get(SEEN_COUNT_KEY, '0')) || 0;

  // ========================================
  // Badge and seen state
  // ========================================

  function markAsSeen() {
    lastSeenCount = openCount;
    storage.set(SEEN_COUNT_KEY, openCount);
  }

  function notifyBadge() {
    const hasNew = openCount > lastSeenCount;
    onCommentCountChange?.({ count: openCount, hasNew });
  }

  // ========================================
  // Utility functions
  // ========================================

  function isOwner() {
    return isCommentOwner(user, pres);
  }

  function isAuthor(comment) {
    return isCommentAuthor(user, comment);
  }

  function getSlideNumber(slideId) {
    if (!slideId || !pres?.slides) return null;
    const index = pres.slides.findIndex((s) => s?.id === slideId);
    return index >= 0 ? index + 1 : null;
  }

  function formatTime(isoString) {
    return formatRelativeTime(isoString, t);
  }

  // ========================================
  // Data loading
  // ========================================

  async function loadComments() {
    try {
      const opts = {};
      if (filter.slideId) opts.slideId = filter.slideId;
      if (filter.status && filter.status !== 'all') opts.status = filter.status;
      if (filter.commentType) opts.commentType = filter.commentType;

      const result = await commentsApi.listComments(opts);
      comments = result.comments || [];
      openCount = result.openCount || 0;
      renderers.renderCommentList(listEl, comments);

      if (isVisible) {
        markAsSeen();
      }
      notifyBadge();

      // Fetch per-slide counts for indicators
      try {
        const countsResult = await commentsApi.getCommentCounts();
        slideCommentCounts = countsResult.counts || {};
        onSlideCommentCountsChange?.(slideCommentCounts);
      } catch {
        // Non-critical, ignore
      }
    } catch (err) {
      toast?.error?.(t('comments.error.loadFailed', 'Failed to load comments'));
    }
  }

  // ========================================
  // Comment submission
  // ========================================

  async function submitComment() {
    const body = inputTextarea.value.trim();
    if (!body) return;

    try {
      await commentsApi.createComment({
        body,
        slideId: getSelectedSlideId?.() || null,
      });
      inputTextarea.value = '';
      loadComments();
    } catch (err) {
      toast?.error?.(t('comments.error.postFailed', 'Failed to post comment'));
    }
  }

  async function handleReply(parentId, body, textarea) {
    try {
      await commentsApi.createComment({
        body,
        parentId,
        slideId: getSelectedSlideId?.() || null,
      });
      textarea.value = '';
      loadComments();
    } catch (err) {
      toast?.error?.(t('comments.error.replyFailed', 'Failed to post reply'));
    }
  }

  // ========================================
  // Create actions handler
  // ========================================

  const actions = createCommentActions({
    api,
    commentsApi,
    presentationId,
    pres,
    toast,
    loadComments,
  });

  // ========================================
  // Create renderers
  // ========================================

  const renderers = createCommentRenderers({
    h,
    filter,
    getSlideNumber,
    formatTime,
    isOwner,
    isAuthor,
    onJumpToSlide,
    onReply: handleReply,
    onResolve: actions.resolveComment,
    onReopen: actions.reopenComment,
    onDelete: actions.deleteComment,
    onDismiss: actions.dismissComment,
    onApply: actions.applySuggestion,
  });

  // ========================================
  // Create SSE handler
  // ========================================

  const sse = createCommentSSE({
    presentationId,
    getOpenCount: () => openCount,
    setOpenCount: (count) => { openCount = count; },
    getSlideCommentCounts: () => slideCommentCounts,
    setSlideCommentCounts: (counts) => { slideCommentCounts = counts; },
    getIsVisible: () => isVisible,
    markAsSeen,
    notifyBadge,
    loadComments,
    onSlideCommentCountsChange,
  });

  // ========================================
  // DOM Construction
  // ========================================

  const panelEl = h('div', { class: 'comments-panel' });
  const headerEl = h('div', { class: 'comments-panel-header' });
  const filterEl = h('div', { class: 'comments-panel-filter' });
  const listEl = h('div', { class: 'comments-panel-list' });
  const inputEl = h('div', { class: 'comments-panel-input' });

  // Header
  const headerTitle = h('h3', { text: t('comments.title', 'Comments') });
  const closeBtn = h('button', {
    class: 'btn btn-icon comments-close-btn',
    type: 'button',
    title: t('comments.close', 'Close'),
    text: '×',
    onclick: () => hide(),
  });
  headerEl.append(headerTitle, closeBtn);

  // Filter buttons - row 1: status filters
  const filterRow1 = h('div', { class: 'comments-filter-row' });
  const filterAllBtn = h('button', {
    class: 'btn btn-sm btn-secondary',
    type: 'button',
    text: t('comments.filter.all', 'All'),
    onclick: () => setFilter({ status: 'all' }),
  });
  const filterOpenBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    type: 'button',
    text: t('comments.filter.open', 'Open'),
    onclick: () => setFilter({ status: 'open' }),
  });
  const filterResolvedBtn = h('button', {
    class: 'btn btn-sm btn-secondary',
    type: 'button',
    text: t('comments.filter.resolved', 'Resolved'),
    onclick: () => setFilter({ status: 'resolved' }),
  });
  const filterSlideBtn = h('button', {
    class: 'btn btn-sm btn-secondary',
    type: 'button',
    text: t('comments.filter.thisSlide', 'This slide'),
    onclick: () => toggleSlideFilter(),
  });
  filterRow1.append(filterAllBtn, filterOpenBtn, filterResolvedBtn, filterSlideBtn);

  // Filter buttons - row 2: type filters (Human / AI)
  const filterRow2 = h('div', { class: 'comments-filter-row comments-filter-type' });
  const filterAllTypesBtn = h('button', {
    class: 'btn btn-sm btn-secondary',
    type: 'button',
    text: t('comments.filter.allTypes', 'All'),
    onclick: () => setFilter({ commentType: null }),
  });
  const filterHumanBtn = h('button', {
    class: 'btn btn-sm btn-secondary',
    type: 'button',
    text: t('comments.filter.human', 'Human'),
    onclick: () => setFilter({ commentType: 'human' }),
  });
  const filterAiBtn = h('button', {
    class: 'btn btn-sm btn-secondary',
    type: 'button',
    text: t('comments.filter.ai', 'AI'),
    onclick: () => setFilter({ commentType: 'ai-suggestion' }),
  });
  filterRow2.append(filterAllTypesBtn, filterHumanBtn, filterAiBtn);

  filterEl.append(filterRow1, filterRow2);

  // Input area
  const inputTextarea = h('textarea', {
    class: 'comments-input-textarea',
    placeholder: t('comments.addPlaceholder', 'Add a comment...'),
    rows: 2,
  });
  inputTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitComment();
    }
  });
  const inputSubmitBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    type: 'button',
    text: t('comments.post', 'Post'),
    onclick: () => submitComment(),
  });
  const inputControls = h('div', { class: 'comments-input-controls' });
  inputControls.append(inputSubmitBtn);
  inputEl.append(inputTextarea, inputControls);

  // Assemble panel
  panelEl.append(headerEl, filterEl, listEl, inputEl);
  panelEl.style.display = 'none';

  // ========================================
  // Filter logic
  // ========================================

  function updateFilterButtons() {
    filterAllBtn.className = `btn btn-sm ${filter.status === 'all' ? 'btn-primary' : 'btn-secondary'}`;
    filterOpenBtn.className = `btn btn-sm ${filter.status === 'open' ? 'btn-primary' : 'btn-secondary'}`;
    filterResolvedBtn.className = `btn btn-sm ${filter.status === 'resolved' ? 'btn-primary' : 'btn-secondary'}`;
    filterSlideBtn.className = `btn btn-sm ${filter.slideId ? 'btn-primary' : 'btn-secondary'}`;
    filterAllTypesBtn.className = `btn btn-sm ${filter.commentType === null ? 'btn-primary' : 'btn-secondary'}`;
    filterHumanBtn.className = `btn btn-sm ${filter.commentType === 'human' ? 'btn-primary' : 'btn-secondary'}`;
    filterAiBtn.className = `btn btn-sm ${filter.commentType === 'ai-suggestion' ? 'btn-primary' : 'btn-secondary'}`;
  }

  function setFilter(opts) {
    if (opts.status !== undefined) {
      filter.status = opts.status;
    }
    if (opts.commentType !== undefined) {
      filter.commentType = opts.commentType;
    }
    updateFilterButtons();
    loadComments();
  }

  function toggleSlideFilter() {
    if (filter.slideId) {
      filter.slideId = null;
    } else {
      filter.slideId = getSelectedSlideId?.() || null;
    }
    updateFilterButtons();
    loadComments();
  }

  // ========================================
  // Panel visibility
  // ========================================

  function show() {
    isVisible = true;
    panelEl.style.display = '';
    markAsSeen();
    notifyBadge();
    loadComments();
  }

  function hide() {
    isVisible = false;
    panelEl.style.display = 'none';
  }

  function toggle() {
    if (isVisible) hide();
    else show();
  }

  function getOpenCount() {
    return openCount;
  }

  function refresh() {
    if (isVisible) loadComments();
  }

  function getSlideCommentCounts() {
    return slideCommentCounts;
  }

  // ========================================
  // Public API
  // ========================================

  return {
    panelEl,
    show,
    hide,
    toggle,
    refresh,
    getOpenCount,
    loadComments,
    getSlideCommentCounts,
    startPolling: sse.startPolling,
    stopPolling: sse.stopPolling,
  };
}