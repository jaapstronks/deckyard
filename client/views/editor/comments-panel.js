/**
 * Comments panel for the editor.
 * Displays slide comments and allows users to add, reply, and resolve.
 */

import { createCommentsApi } from './comments-api.js';
import { t } from '../../lib/ui-i18n.js';
import { closeIcon, makeDropdownCaret } from '../../lib/icons.js';
import { createDropdown } from '../../lib/dropdown.js';
import { createSegmented } from '../../lib/segmented.js';
import { formatRelativeTime } from '../../lib/format-time.js';
import { isCommentOwner, isCommentAuthor } from '../../lib/comment-authz.js';
import { storage } from '../../lib/storage.js';
import { confirmModal } from '../../lib/modal.js';
import { attachMentionAutocomplete } from '../../lib/mention-autocomplete.js';
import { createRichCommentInput } from '../../lib/comment-rich-input.js';
import { parseMentions } from '../../../shared/comment-mentions.js';
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
      // "This slide" with no slide to scope to (a deck with zero slides, or
      // before the first selection lands). Leaving slideId off the request
      // would quietly widen the scope to the whole deck while the switch still
      // reads "This slide", so the list is emptied explicitly instead. The
      // request still goes out unscoped: openCount drives the deck-wide badge.
      filter.slideMissing = scope === 'slide' && !filter.slideId;
      const opts = {};
      if (filter.slideId) opts.slideId = filter.slideId;
      if (filter.status && filter.status !== 'all') opts.status = filter.status;
      if (filter.commentType) opts.commentType = filter.commentType;

      const result = await commentsApi.listComments(opts);
      comments = result.comments || [];
      openCount = result.openCount || 0;
      const visibleThreads = filter.slideMissing
        ? []
        : filter.attention === 'waiting'
          ? comments.filter((c) => threadWaitsFor(c, user?.email))
          : comments;
      // The re-render destroys any open reply inputs; release their
      // autocomplete listeners with them.
      detachEphemeralMentions();
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
  // Mentions: access knowledge + pre-post check
  // ========================================

  // Emails known to have access (owner + collaborators). Only owners/admins
  // may list collaborators; when that fails the list is not authoritative
  // and the access prompt is skipped (we only warn when we KNOW access is
  // missing).
  let accessEmails = null;
  let accessListAuthoritative = false;

  async function loadAccessEmails() {
    if (accessEmails !== null) return accessEmails;
    const emails = new Set();
    const owner = String(pres?.ownerEmail || pres?.createdBy || '').toLowerCase();
    if (owner) emails.add(owner);
    try {
      const resp = await api(`/api/presentations/${presentationId}/collaborators`);
      for (const c of resp?.collaborators || []) {
        const email = String(c?.userEmail || '').toLowerCase();
        if (email) emails.add(email);
      }
      accessListAuthoritative = true;
    } catch {
      accessListAuthoritative = false;
    }
    accessEmails = emails;
    return accessEmails;
  }

  /**
   * Warn when mentioned users have no access to this deck; offer to share
   * with comment rights. Non-blocking: the comment posts either way.
   */
  async function checkMentionAccess(body) {
    const mentions = parseMentions(body);
    if (mentions.length === 0) return;
    await loadAccessEmails();
    if (!accessListAuthoritative) return;
    const missing = mentions.filter((m) => !accessEmails.has(m.email));
    if (missing.length === 0) return;

    const names = missing.map((m) => m.name || m.email).join(', ');
    const share = await confirmModal(h, document.body, {
      title: t('mentions.noAccess.title', 'No access to this presentation'),
      message: t(
        'mentions.noAccess.message',
        '{names} cannot see this presentation, so the mention will not help them. Share it with comment access?',
        { names }
      ),
      confirmLabel: t('mentions.noAccess.share', 'Share with comment access'),
      cancelLabel: t('mentions.noAccess.postAnyway', 'Post anyway'),
    });
    if (!share) return;
    try {
      await api(`/api/presentations/${presentationId}/collaborators`, {
        method: 'POST',
        body: JSON.stringify({
          userEmails: missing.map((m) => m.email),
          permission: 'comment',
        }),
      });
      for (const m of missing) accessEmails.add(m.email);
      toast?.success?.(t('mentions.shared', 'Shared with comment access'));
    } catch {
      toast?.error?.(t('mentions.shareFailed', 'Could not share the presentation'));
    }
  }

  // ========================================
  // Comment submission
  // ========================================

  async function submitComment() {
    const body = commentInput.getValue().trim();
    if (!body) return;

    try {
      await checkMentionAccess(body);
      await commentsApi.createComment({
        body,
        slideId: getSelectedSlideId?.() || null,
      });
      commentInput.clear();
      loadComments();
    } catch (err) {
      toast?.error?.(t('comments.error.postFailed', 'Failed to post comment'));
    }
  }

  async function handleReply(parentId, body, replyInput) {
    try {
      await checkMentionAccess(body);
      await commentsApi.createComment({
        body,
        parentId,
        slideId: getSelectedSlideId?.() || null,
      });
      replyInput.clear();
      loadComments();
    } catch (err) {
      toast?.error?.(t('comments.error.replyFailed', 'Failed to post reply'));
    }
  }

  // ========================================
  // Mention autocomplete plumbing
  // ========================================

  const mentionDetachers = [];
  const ephemeralMentionDetachers = new Set();

  /**
   * Attach @-autocomplete to a comment composer. The popover mounts inside
   * `host`, which gets position:relative via .has-mention-autocomplete.
   * Guests are not mentionable and guests can't mention (no account): the
   * whole feature is authed-user-only.
   *
   * `richInput` is a `createRichCommentInput` instance; it doubles as the
   * caret adapter (same `getTextBeforeCaret` / `replaceQueryWithMention`
   * shape a textarea adapter provides), so a picked user lands as a chip.
   *
   * Reply inputs pass `ephemeral: true`: they are created on every Reply
   * toggle and destroyed by each list re-render, so their document-level
   * dismiss listeners must be released with them (drained per render;
   * the toggle path calls `host._detachMentions` directly).
   */
  function attachMentions(richInput, host, { ephemeral = false } = {}) {
    if (!user?.email) return null;
    const ac = attachMentionAutocomplete({
      adapter: richInput,
      api,
      getPriorityEmails: () => (accessEmails ? [...accessEmails] : []),
    });
    host.classList.add('has-mention-autocomplete');
    host.append(ac.el);
    // Warm the priority list in the background on first attach.
    loadAccessEmails();
    if (ephemeral) {
      const detach = () => {
        ephemeralMentionDetachers.delete(detach);
        try { ac.detach(); } catch { /* ignore */ }
      };
      ephemeralMentionDetachers.add(detach);
      host._detachMentions = detach;
    } else {
      mentionDetachers.push(ac.detach);
    }
    return ac;
  }

  function detachEphemeralMentions() {
    for (const d of [...ephemeralMentionDetachers]) d();
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
    attachMentions,
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
  // `setScope` is the single owner of the selection (it also reloads), so the
  // control reports clicks rather than moving its own highlight.
  const scopeSegmented = createSegmented({
    h,
    outlined: true,
    className: 'comments-scope',
    buttonClass: 'comments-scope-btn',
    ariaLabel: t('comments.scope.label', 'Comments scope'),
    value: 'slide',
    selectOnClick: false,
    segments: [
      { value: 'slide', label: t('comments.filter.thisSlide', 'This slide') },
      { value: 'all', label: t('comments.scope.allSlides', 'All slides') },
    ],
    onSelect: (next) => setScope(next),
  });
  const scopeEl = scopeSegmented.el;

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
  const {
    details: filterDetails,
    menu: filterMenu,
    close: closeFilterMenu,
    detach: detachFilterMenu,
  } = createDropdown({
    h,
    triggerClass: 'btn btn-sm btn-secondary comments-filter-trigger',
    triggerContent: [filterMenuLabel, makeDropdownCaret()],
    title: t('comments.filter.title', 'Filter comments'),
    detailsClass: 'comments-filter-dropdown',
    menuClass: 'dropdown-menu-right comments-filter-menu',
  });

  const statusItems = STATUS_OPTIONS.map((opt) => {
    const item = h('button', {
      class: 'dropdown-item comments-filter-item',
      type: 'button',
      text: opt.label(),
      onclick: () => {
        closeFilterMenu();
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
        closeFilterMenu();
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
        closeFilterMenu();
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

  // Input area. Mentions show as chips while typing; `getValue()` serialises
  // back to the canonical `@[Name](user:email)` markup the server parses.
  let mainMentionAc = null;
  const commentInput = createRichCommentInput({
    className: 'comments-input-textarea',
    placeholder: t('comments.addPlaceholder', 'Add a comment...'),
    onSubmit: () => submitComment(),
    // With the mention popover open, Enter picks a user instead.
    isSubmitBlocked: () => !!mainMentionAc?.isOpen(),
  });
  const inputSubmitBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    type: 'button',
    text: t('comments.post', 'Post'),
    onclick: () => submitComment(),
  });
  const inputControls = h('div', { class: 'comments-input-controls' });
  inputControls.append(inputSubmitBtn);
  inputEl.append(commentInput.el, inputControls);
  mainMentionAc = attachMentions(commentInput, inputEl);

  // Assemble panel
  panelEl.append(headerEl, filterEl, listEl, inputEl);
  panelEl.style.display = 'none';

  // ========================================
  // Filter logic
  // ========================================

  function updateFilterUi() {
    scopeSegmented.setValue(scope);

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
      for (const d of mentionDetachers) {
        try { d(); } catch { /* ignore */ }
      }
      detachEphemeralMentions();
      detachFilterMenu();
    },
  };
}