/**
 * Comments panel for the editor.
 * Displays slide comments and allows users to add, reply, and resolve.
 */

import { createCommentsApi } from './comments-api.js';
import { t } from '../../lib/ui-i18n.js';
import { closeIcon, makeDropdownCaret } from '../../lib/icons.js';
import { installDismissOnOutside } from '../../lib/dom.js';
import { formatRelativeTime } from '../../lib/format-time.js';
import { isCommentOwner, isCommentAuthor } from '../../lib/comment-authz.js';
import { storage } from '../../lib/storage.js';
import { createCommentRenderers } from './comments-panel-renderers.js';
import { createCommentActions } from './comments-panel-actions.js';
import { createCommentSSE } from './comments-panel-sse.js';
import { threadWaitsFor, collectUnreadThreadIds } from './comments-read-state.js';

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
  onRequestClose,
}) {
  const commentsApi = createCommentsApi({ api, presentationId });

  // State
  let comments = [];
  let openCount = 0;
  let slideCommentCounts = {};
  // Scope is the primary axis: the pane is slide-scoped by default (like the
  // inspector and notes panes it sits between); "All slides" is the explicit
  // deck-wide overview. filter.slideId is DERIVED from scope on every load,
  // so the slide scope follows the selection. The object identity of
  // `filter` matters: the renderers hold a reference to it.
  let scope = 'slide';
  // attention is a client-side lens on the loaded threads: 'waiting' keeps
  // only open threads whose latest message is not yours ("waiting for me").
  // Heuristic, not a status — nothing is stored.
  let filter = { slideId: null, status: 'open', commentType: null, attention: null };
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
      filter.slideId = scope === 'slide' ? (getSelectedSlideId?.() || null) : null;
      const opts = {};
      if (filter.slideId) opts.slideId = filter.slideId;
      if (filter.status && filter.status !== 'all') opts.status = filter.status;
      if (filter.commentType) opts.commentType = filter.commentType;

      const result = await commentsApi.listComments(opts);
      comments = result.comments || [];
      openCount = result.openCount || 0;
      const visibleThreads = filter.attention === 'waiting'
        ? comments.filter((c) => threadWaitsFor(c, user?.email))
        : comments;
      renderers.renderCommentList(listEl, visibleThreads);

      if (isVisible) {
        markAsSeen();
        scheduleMarkThreadsRead(visibleThreads);
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

  // Trailing debounce so arrow-key slide navigation with an open pane fires
  // one fetch pair for the slide you land on, not one per slide passed.
  let loadDebounceTimer = null;
  function scheduleLoadComments() {
    if (loadDebounceTimer) clearTimeout(loadDebounceTimer);
    loadDebounceTimer = setTimeout(() => {
      loadDebounceTimer = null;
      loadComments();
    }, 150);
  }

  // ========================================
  // Read-state (per-user, batched)
  // ========================================

  // Viewing a thread in the panel marks it read, but batched: ids collect
  // here and flush once per pause. The dots stay as rendered until the next
  // reload, so you still see what was new. Guests have no account: no email,
  // no read-state, no calls.
  const pendingReadIds = new Set();
  let markReadTimer = null;
  function scheduleMarkThreadsRead(threads) {
    if (!user?.email) return;
    for (const id of collectUnreadThreadIds(threads)) pendingReadIds.add(id);
    if (pendingReadIds.size === 0) return;
    if (markReadTimer) clearTimeout(markReadTimer);
    markReadTimer = setTimeout(() => {
      markReadTimer = null;
      const ids = [...pendingReadIds];
      pendingReadIds.clear();
      commentsApi.markThreadsRead(ids).catch(() => {
        // Non-critical: dots simply reappear next session.
      });
    }, 1200);
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
    class: 'ghost-icon-btn comments-close-btn',
    type: 'button',
    title: t('comments.close', 'Close'),
    'aria-label': t('comments.close', 'Close'),
    // Mounted as an inspector pane the host owns visibility: closing means
    // dismissing the rail (onRequestClose), not just hiding this element.
    onclick: () => (onRequestClose ? onRequestClose() : hide()),
  });
  closeBtn.append(closeIcon({ size: 16 }));
  headerEl.append(headerTitle, closeBtn);

  // Scope switch: the pane shows the current slide's threads by default (the
  // same order as the inspector/notes panes); "All slides" is the explicit
  // deck-wide overview, where each comment links to its slide.
  const scopeSlideBtn = h('button', {
    class: 'comments-scope-btn',
    type: 'button',
    text: t('comments.filter.thisSlide', 'This slide'),
    'aria-pressed': 'true',
    onclick: () => setScope('slide'),
  });
  const scopeAllBtn = h('button', {
    class: 'comments-scope-btn',
    type: 'button',
    text: t('comments.scope.allSlides', 'All slides'),
    'aria-pressed': 'false',
    onclick: () => setScope('all'),
  });
  const scopeEl = h(
    'div',
    { class: 'comments-scope', role: 'group', 'aria-label': t('comments.scope.label', 'Comments scope') },
    [scopeSlideBtn, scopeAllBtn]
  );

  // Status + type live in one compact filter menu next to the scope switch
  // (they refine the list; scope decides what the list is about).
  const STATUS_OPTIONS = [
    { value: 'open', label: () => t('comments.filter.open', 'Open') },
    { value: 'resolved', label: () => t('comments.filter.resolved', 'Resolved') },
    { value: 'all', label: () => t('comments.filter.all', 'All') },
  ];
  const TYPE_OPTIONS = [
    { value: null, label: () => t('comments.filter.allTypes', 'All') },
    { value: 'human', label: () => t('comments.filter.human', 'Human') },
    { value: 'ai-suggestion', label: () => t('comments.filter.ai', 'AI') },
  ];
  const ATTENTION_OPTIONS = [
    { value: null, label: () => t('comments.filter.everyone', 'Everything') },
    { value: 'waiting', label: () => t('comments.filter.waitingForMe', 'Waiting for me') },
  ];

  const filterMenuLabel = h('span', { class: 'comments-filter-label', text: '' });
  const filterSummary = h(
    'summary',
    {
      class: 'btn btn-sm btn-secondary dropdown-trigger comments-filter-trigger',
      title: t('comments.filter.title', 'Filter comments'),
    },
    [filterMenuLabel, makeDropdownCaret()]
  );
  const filterMenu = h('div', { class: 'dropdown-menu dropdown-menu-right comments-filter-menu' });
  const filterDetails = h('details', { class: 'dropdown comments-filter-dropdown' }, [
    filterSummary,
    filterMenu,
  ]);
  const detachFilterMenu = installDismissOnOutside({
    rootEl: filterDetails,
    isOpen: () => !!filterDetails.open,
    close: () => { filterDetails.open = false; },
  });

  const statusItems = STATUS_OPTIONS.map((opt) => {
    const item = h('button', {
      class: 'dropdown-item comments-filter-item',
      type: 'button',
      text: opt.label(),
      onclick: () => {
        filterDetails.open = false;
        setFilter({ status: opt.value });
      },
    });
    item.dataset.status = String(opt.value);
    return item;
  });
  const typeItems = TYPE_OPTIONS.map((opt) => {
    const item = h('button', {
      class: 'dropdown-item comments-filter-item',
      type: 'button',
      text: opt.label(),
      onclick: () => {
        filterDetails.open = false;
        setFilter({ commentType: opt.value });
      },
    });
    item.dataset.type = String(opt.value);
    return item;
  });
  const attentionItems = ATTENTION_OPTIONS.map((opt) => {
    const item = h('button', {
      class: 'dropdown-item comments-filter-item',
      type: 'button',
      text: opt.label(),
      onclick: () => {
        filterDetails.open = false;
        setFilter({ attention: opt.value });
      },
    });
    item.dataset.attention = String(opt.value);
    return item;
  });
  filterMenu.append(
    h('div', { class: 'dropdown-help', text: t('comments.filter.status', 'Status') }),
    ...statusItems,
    h('div', { class: 'dropdown-sep' }),
    h('div', { class: 'dropdown-help', text: t('comments.filter.type', 'Type') }),
    ...typeItems,
    h('div', { class: 'dropdown-sep' }),
    h('div', { class: 'dropdown-help', text: t('comments.filter.attention', 'Attention') }),
    ...attentionItems
  );

  filterEl.append(scopeEl, filterDetails);

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

  function updateFilterUi() {
    scopeSlideBtn.classList.toggle('is-active', scope === 'slide');
    scopeSlideBtn.setAttribute('aria-pressed', String(scope === 'slide'));
    scopeAllBtn.classList.toggle('is-active', scope === 'all');
    scopeAllBtn.setAttribute('aria-pressed', String(scope === 'all'));

    const statusOpt = STATUS_OPTIONS.find((o) => o.value === filter.status) || STATUS_OPTIONS[0];
    const typeOpt = TYPE_OPTIONS.find((o) => o.value === filter.commentType) || TYPE_OPTIONS[0];
    const attentionOpt = ATTENTION_OPTIONS.find((o) => o.value === filter.attention) || ATTENTION_OPTIONS[0];
    // The trigger label names the active refinement; type and attention only
    // when they narrow ("Open", "Open · AI", "Open · Waiting for me").
    const labelParts = [statusOpt.label()];
    if (typeOpt.value !== null) labelParts.push(typeOpt.label());
    if (attentionOpt.value !== null) labelParts.push(attentionOpt.label());
    filterMenuLabel.textContent = labelParts.join(' · ');

    for (const item of statusItems) {
      item.classList.toggle('is-selected', item.dataset.status === String(filter.status));
    }
    for (const item of typeItems) {
      item.classList.toggle('is-selected', item.dataset.type === String(filter.commentType));
    }
    for (const item of attentionItems) {
      item.classList.toggle('is-selected', item.dataset.attention === String(filter.attention));
    }
  }

  function setScope(next) {
    if (scope === next) return;
    scope = next;
    updateFilterUi();
    // A hidden pane reloads on the next show() anyway; loading here too made
    // setScope('all') + open('comments') fetch twice (AI review path).
    if (!isVisible) return;
    loadComments();
  }

  function setFilter(opts) {
    if (opts.status !== undefined) {
      filter.status = opts.status;
    }
    if (opts.commentType !== undefined) {
      filter.commentType = opts.commentType;
    }
    if (opts.attention !== undefined) {
      filter.attention = opts.attention;
    }
    updateFilterUi();
    loadComments();
  }

  /**
   * The selected slide changed: a slide-scoped pane follows it. Called by
   * the controller on every slide selection; a hidden pane reloads on the
   * next show() anyway.
   */
  function onSlideChanged() {
    if (scope !== 'slide' || !isVisible) return;
    scheduleLoadComments();
  }

  updateFilterUi();

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

  /**
   * Scroll a thread into view and flash it (used by the positioned comment
   * markers on the canvas, which used to expand the under-slide list).
   * No-op when the comment is filtered out of the current view.
   * @param {string} commentId
   */
  async function highlightComment(commentId) {
    await loadComments();
    const el = listEl.querySelector(`[data-comment-id="${commentId}"]`);
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'center' });
    } catch { /* ignore */ }
    el.classList.add('is-highlighted');
    setTimeout(() => el.classList.remove('is-highlighted'), 2000);
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
    highlightComment,
    onSlideChanged,
    setScope,
    startPolling: sse.startPolling,
    stopPolling: sse.stopPolling,
    detach: () => {
      if (loadDebounceTimer) clearTimeout(loadDebounceTimer);
      if (markReadTimer) clearTimeout(markReadTimer);
      detachFilterMenu();
    },
  };
}