import { openSlideTypeModal as openSlideTypeModalImpl } from './modals/slide-type-modal.js';
import { openSlideLibraryModal as openSlideLibraryModalImpl } from './modals/slide-library-modal.js';
import { openFollowInviteSuggestModal } from './modals/follow-invite-suggest-modal.js';
import { createSlideTypePicker } from './slide-type-picker.js';
import { deepClone, makeNewSlide } from './editor-utils.js';
import { seedAutoBackgroundPreset } from '../../../shared/theme-background-presets.js';
import { t } from '../../lib/ui-i18n.js';
import { newId } from '../../lib/util/id.js';
import { createSlideLibraryPicker } from './slide-library-picker.js';
import { toast } from '../../lib/dom/toast.js';
import { debugLog } from '../../lib/util/debug.js';
import { isInsertableSlideType } from './slide-types-policy.js';
import { sortByPinnedThenName } from '../../lib/slide-library/search.js';
import { createSlidesPanelResize } from './slides-panel-resize.js';
import { createSlidesPanelActions } from './slides-panel-actions.js';
import { isLiveSlideType } from '../../../shared/slide-types/runtime.js';
import { applyInstanceKeyRekey } from '../../../shared/slide-types/instance-keys.js';
import {
  followInvitePlacements,
  insertSlideAfter,
} from './slide-insert-position.js';
import { h } from '../../lib/dom.js';

// Which slide types need audience participation, and therefore a follow-invite
// slide in the deck for the audience to join through. Declared by the type
// (`runtime: 'live'`), not listed here — this used to be one of nine hand-rolled
// copies of the same four names. See shared/slide-types/runtime.js.
function isInteractiveSlideType(type) {
  return isLiveSlideType(type);
}

function hasFollowInviteSlide(slides) {
  return (
    Array.isArray(slides) &&
    slides.some((s) => s?.type === 'follow-invite-slide')
  );
}

export function createSlidesPanel({
  root,
  pres,
  user,
  api,
  features,
  theme,
  SLIDE_TYPES,
  disabledSlideTypes,
  editorState,
  rerenderSlideList,
  getSelectedSlideId,
  setSelectedSlideId,
  getSelectedSlideIds,
  clearMultiSelection,
  openAiAppendWizardModal,
  openDeckOverview,
  isSlidesCollapsed,
  setSlidesCollapsed,
  isAuthor,
} = {}) {
  const flags = features && typeof features === 'object' ? features : {};
  let slideDrawerOpen = false;
  let slideDrawerAfterId = null;
  let searchQuery = '';

  const left = h('div', { class: 'panel slides-panel' });
  const leftHeader = h('div', {
    class: 'row spread slides-panel-header',
  });

  // Resize handle for drag-to-resize (PowerPoint/Keynote style)
  const { handleEl: resizeHandle } = createSlidesPanelResize({
    panelEl: left,
    isSlidesCollapsed,
  });

  const leftScroll = h('div', { class: 'panel-scroll' });

  const drawerEl = h('div', {
    class: 'slide-add-drawer',
    hidden: true,
  });
  const drawerHeader = h('div', {
    class: 'row spread',
  });
  const drawerBody = h('div', { class: 'slide-add' });

  const slideListEl = h('div', { class: 'list' });

  const searchInput = h('input', {
    class: 'form-input slides-search-input',
    type: 'search',
    placeholder: t('editor.slides.search.placeholder', 'Search slides…'),
    value: '',
    'aria-label': t('editor.slides.search.aria', 'Search slides'),
  });
  const searchClearBtn = h('button', {
    class: 'btn btn-secondary is-compact slides-search-clear',
    type: 'button',
    text: '×',
    title: t('editor.slides.search.clear', 'Clear search'),
  });
  const searchStatsEl = h('div', {
    class: 'slides-search-stats',
    text: '',
  });
  const searchRow = h('div', { class: 'slides-search-row' }, [
    searchInput,
    searchClearBtn,
    searchStatsEl,
  ]);

  const setSearchStats = (stats) => {
    const q = String(stats?.query ?? searchQuery ?? '').trim();
    const total = Number(stats?.total ?? (pres?.slides || []).length) || 0;
    const shown =
      typeof stats?.shown === 'number' ? stats.shown : q ? 0 : total;
    if (!q) searchStatsEl.textContent = '';
    else searchStatsEl.textContent = `${shown}/${total}`;
  };

  const applySearch = (q, { autoSelect = true } = {}) => {
    searchQuery = String(q ?? '').trim();
    searchInput.value = searchQuery;
    const stats = rerenderSlideList?.() || null;
    setSearchStats(stats);

    // If the current selection is hidden by the filter, auto-select the first match.
    const qNow = String(stats?.query ?? searchQuery ?? '').trim();
    const matchedIds = Array.isArray(stats?.matchedIds) ? stats.matchedIds : [];
    if (autoSelect && qNow && matchedIds.length) {
      const cur = getSelectedSlideId?.();
      if (!matchedIds.includes(cur)) {
        setSelectedSlideId?.(matchedIds[0]);
        editorState.refreshAll();
      }
    }
  };

  // Debounce only the per-keystroke input path. Each `rerenderSlideList()`
  // rebuilds every thumbnail from scratch (`slide-list.js:305`,
  // `slideListEl.innerHTML = ''`), so typing an 8-char query used to trigger 8
  // full rebuilds — ~137 ms of blocked main thread on an 80-slide deck. The
  // timer resets on each keystroke, so a word typed at fluent cadence
  // (~120–180 ms between keys) collapses into a single rebuild that fires once
  // the user pauses. 200 ms sits just above that cadence yet inside the
  // search-as-you-type responsiveness band, so results still feel immediate.
  const SEARCH_DEBOUNCE_MS = 200;
  let searchDebounceTimer = null;
  const cancelPendingSearch = () => {
    if (searchDebounceTimer != null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
  };
  // Immediate path — clear and the programmatic entry (AI review) render right
  // away, and drop any keystroke render still queued so it can't fire stale.
  const applySearchNow = (q, opts) => {
    cancelPendingSearch();
    applySearch(q, opts);
  };
  const applySearchDebounced = () => {
    cancelPendingSearch();
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      applySearch(searchInput.value);
    }, SEARCH_DEBOUNCE_MS);
  };

  searchInput.addEventListener('input', applySearchDebounced);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      applySearchNow('', { autoSelect: false });
      try {
        searchInput.blur();
      } catch {
        // ignore
      }
    }
  });
  searchClearBtn.addEventListener('click', () => {
    applySearchNow('', { autoSelect: false });
    searchInput.focus?.();
  });

  // Bulk action bar and paste bar (extracted to separate module)
  const {
    bulkActionBar,
    pasteBar,
    updateBulkActionBar,
    pasteFromClipboard,
    copySelectedSlides,
  } = createSlidesPanelActions({
    pres,
    toast,
    SLIDE_TYPES,
    getSelectedSlideId,
    setSelectedSlideId,
    getSelectedSlideIds,
    clearMultiSelection,
    rerenderSlideList,
    editorState,
    isAuthor,
  });

  const closeDrawer = () => {
    slideDrawerOpen = false;
    slideDrawerAfterId = null;
    drawerEl.classList.remove('is-open');
    drawerEl.hidden = true;
  };

  drawerHeader.append(
    h('div', {
      class: 'slide-add-title',
      text: t('editor.slides.add', 'Add slide'),
    }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('common.close', 'Close'),
      onclick: () => closeDrawer(),
    }),
  );
  drawerEl.append(drawerHeader, drawerBody);

  const maybeAssignRandomBg = (slide) => {
    // Types declaring autoBackgroundPreset get a random theme background on the
    // canonical key. Same helper as newSlide(), so a slide inserted here and
    // one created server-side come out identical.
    seedAutoBackgroundPreset(slide?.content, SLIDE_TYPES?.[slide?.type], theme);
  };

  const insertSlideObject = (s, { afterSlideId, parentId = null } = {}) => {
    const slides = pres.slides || [];
    // Set parentId for nested slides
    if (parentId) {
      s.parentId = parentId;
    }
    insertSlideAfter(slides, s, afterSlideId);
    setSelectedSlideId?.(s.id);
    editorState.dirtyRefreshAll();

    // Keep user oriented: ensure the newly inserted slide is visible in the list.
    requestAnimationFrame(() => {
      const active = slideListEl.querySelector('.list-item.is-active');
      active?.scrollIntoView?.({ block: 'nearest' });
    });
  };

  // Helper to insert a follow-invite slide at a specific position
  const insertFollowInviteSlide = (afterSlideId) => {
    const s = makeNewSlide('follow-invite-slide', SLIDE_TYPES, {
      lang: pres?.i18n?.active,
      presentationId: pres?.id || '',
    });
    // No language on the content: the invite renders in the language of the
    // version it sits in, derived from the render context.
    insertSlideObject(s, { afterSlideId });
    return s.id;
  };

  // Get the ID of the first slide (title slide) for inserting as second slide
  const getFirstSlideId = () => {
    const slides = pres?.slides || [];
    return slides.length > 0 ? slides[0]?.id : null;
  };

  /**
   * Offer the follow-invite suggestion for a pending interactive slide, and
   * carry out whichever placement the user picks. Both insertion paths (type
   * picker and slide library) go through here so the three placements cannot
   * drift apart; the rules themselves live in slide-insert-position.js.
   *
   * @param {Object} options
   * @param {Object} options.pendingSlide - the interactive slide waiting to land
   * @param {string|null|undefined} options.afterSlideId - where it was headed
   * @param {string|null} [options.parentId] - parent, when it is being nested
   */
  const suggestFollowInvite = ({
    pendingSlide,
    afterSlideId,
    parentId = null,
  }) => {
    openFollowInviteSuggestModal({
      root,
      ...followInvitePlacements({
        afterSlideId,
        parentId,
        getFirstSlideId,
        insertInvite: insertFollowInviteSlide,
        insertPending: (anchorId) =>
          insertSlideObject(pendingSlide, { afterSlideId: anchorId, parentId }),
      }),
    });
  };

  const canEditCustomHtml = Boolean(user?.canEditCustomHtml);

  const insertSlide = (
    type,
    { afterSlideId, parentId = null, contentOverrides = null } = {},
  ) => {
    if (
      !isInsertableSlideType({
        type,
        def: SLIDE_TYPES?.[type],
        theme,
        disabledSlideTypes,
        canEditCustomHtml,
      })
    ) {
      toast?.error?.('This slide type is not available for the active theme.');
      return;
    }
    const s = makeNewSlide(type, SLIDE_TYPES, {
      lang: pres?.i18n?.active,
      presentationId: pres?.id || '',
    });
    // Layout-variant presets (picker item 15) pre-configure a few content fields
    // (e.g. imageSide, layout, variant) on top of the type's defaults.
    if (contentOverrides && typeof contentOverrides === 'object') {
      Object.assign(s.content, contentOverrides);
    }
    maybeAssignRandomBg(s);

    // An interactive slide needs an invite for the audience to join through:
    // if the deck has none, ask where it should go before inserting either.
    if (isInteractiveSlideType(type) && !hasFollowInviteSlide(pres?.slides)) {
      suggestFollowInvite({ pendingSlide: s, afterSlideId, parentId });
      return;
    }

    insertSlideObject(s, { afterSlideId, parentId });
  };

  // Recent/pinned library slides for the inline "From your library" strip
  // (item 10). One shelf's worth: filtered to insertable, non-trashed items and
  // sorted like the library tab (favourites first). The picker decides how many
  // of each shelf to show, so this returns the full sorted list (uncapped).
  // Errors -> empty, so a failing shelf simply drops out of the strip. Matches
  // the library tab's non-theme-filtered fetch.
  const loadLibraryStripShelf = async (endpoint) => {
    try {
      const r = await api(endpoint);
      const items = Array.isArray(r?.items) ? r.items : [];
      const usable = items.filter((it) => {
        if (it?.isTrashed || it?.trashedAt) return false;
        const type = String(it?.slideType || '').trim();
        return (
          type &&
          isInsertableSlideType({
            type,
            def: SLIDE_TYPES?.[type],
            theme,
            disabledSlideTypes,
            canEditCustomHtml,
          })
        );
      });
      return sortByPinnedThenName(usable);
    } catch {
      return [];
    }
  };

  // Fetch both shelves in parallel so the strip can show a mix of personal and
  // organization slides (the picker splits the available tiles between them).
  const loadLibraryStripItems = async () => {
    const [personal, organization] = await Promise.all([
      loadLibraryStripShelf('/api/slide-library/personal'),
      loadLibraryStripShelf('/api/slide-library/organization'),
    ]);
    return { personal, organization };
  };

  const { renderSlideTypePicker } = createSlideTypePicker({
    SLIDE_TYPES,
    theme,
    insertSlide,
    disabledSlideTypes,
    canEditCustomHtml,
    // Escape hatch: when a search finds no matching type, offer to build it with
    // AI, seeded with the query. Lazy arrow — openAiAppendWizard is defined below
    // and only invoked at click time. Null when AI is disabled (button hidden).
    requestAi: !flags.enableAi
      ? null
      : ({ afterSlideId, query } = {}) =>
          openAiAppendWizard({ afterSlideId, initialPrompt: query || '' }),
    // Inline library strip. insertLibraryItem is a lazy arrow because
    // insertFromLibraryItem is defined just below and only called at click time.
    loadLibraryStripItems,
    insertLibraryItem: (item, opts) => insertFromLibraryItem(item, opts),
  });

  // Record that this library slide was used (clears the Home "new to you"
  // badge for the current user). Best-effort: never block or fail the insert.
  const recordLibraryUsage = (item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    api('/api/slide-library/usage', {
      method: 'POST',
      body: JSON.stringify({ items: [{ type: 'slide', id }] }),
    }).catch((err) =>
      debugLog('[slides-panel] library-usage ping failed', err),
    );
  };

  const insertFromLibraryItem = (item, { afterSlideId } = {}) => {
    const type = String(item?.slideType || '').trim();
    if (!type) return;
    if (
      !isInsertableSlideType({
        type,
        def: SLIDE_TYPES?.[type],
        theme,
        disabledSlideTypes,
        canEditCustomHtml,
      })
    ) {
      toast?.error?.('This slide type is not available for the active theme.');
      return;
    }
    const s = makeNewSlide(type, SLIDE_TYPES, {
      lang: pres?.i18n?.active,
      presentationId: pres?.id || '',
    });
    const nextContent =
      item?.content && typeof item.content === 'object'
        ? deepClone(item.content)
        : {};
    s.content = { ...s.content, ...nextContent };
    // A library item is a copy of a slide, so the instance-bound content keys
    // its type declares are re-derived here too — a reused poll gets its own
    // pollId, a reused follow-invite points at this deck. Declaration:
    // shared/slide-types/instance-keys.js.
    applyInstanceKeyRekey(s, {
      def: SLIDE_TYPES?.[type] || null,
      presentationId: pres?.id || '',
      newId,
    });
    maybeAssignRandomBg(s);
    recordLibraryUsage(item);

    // Same suggestion as the type picker: a library copy of an interactive
    // slide still needs an invite in the deck.
    if (isInteractiveSlideType(type) && !hasFollowInviteSlide(pres?.slides)) {
      suggestFollowInvite({ pendingSlide: s, afterSlideId });
      return;
    }

    insertSlideObject(s, { afterSlideId });
  };

  const { renderSlideLibraryPicker } = createSlideLibraryPicker({
    api,
    pres,
    SLIDE_TYPES,
    insertFromLibraryItem,
  });

  const openSlideDrawer = ({ afterSlideId } = {}) => {
    slideDrawerOpen = true;
    slideDrawerAfterId =
      typeof afterSlideId === 'undefined'
        ? getSelectedSlideId?.()
        : afterSlideId;
    drawerEl.hidden = false;
    drawerEl.classList.add('is-open');
    renderSlideTypePicker(drawerBody, {
      afterSlideId: slideDrawerAfterId,
      onPicked: () => closeDrawer(),
    });
  };

  // Drawer contents are re-rendered on open so it always inserts at the intended location.
  const openSlideTypeModal = ({ afterSlideId, parentId } = {}) =>
    openSlideTypeModalImpl({
      root,
      pres,
      afterSlideId,
      parentId,
      closeDrawer,
      openAiAppendWizard,
      renderSlideTypePicker,
      renderSlideLibraryPicker,
      api,
      onSlidesImported: (result) => {
        // Merge server response into local pres to avoid conflict
        // (server already saved, so we update local state to match)
        if (result?.presentation) {
          const updated = result.presentation;
          if (Array.isArray(updated.slides)) pres.slides = updated.slides;
          if (typeof updated.revision === 'number')
            pres.revision = updated.revision;
          if (typeof updated.modified === 'string')
            pres.modified = updated.modified;
        }
        // Refresh the editor state after slides are imported
        editorState.refreshAll();
        // Select the first imported slide
        if (result?.slideIds?.length > 0) {
          setSelectedSlideId?.(result.slideIds[0]);
        }
        // Do NOT call markDirty() - server already saved the import
      },
    });

  const openSlideLibraryModal = ({
    initialShelf = 'organization',
    initialQuery = '',
    afterSlideId,
    allowInsert = true,
  } = {}) =>
    openSlideLibraryModalImpl({
      root,
      api,
      pres,
      SLIDE_TYPES,
      afterSlideId:
        typeof afterSlideId === 'undefined'
          ? getSelectedSlideId?.()
          : afterSlideId,
      insertFromLibraryItem,
      initialShelf,
      initialQuery,
      allowInsert,
    });

  const openAiAppendWizard = ({ afterSlideId, initialPrompt = '' } = {}) => {
    if (!flags.enableAi) return;
    return openAiAppendWizardModal({
      root,
      pres,
      // Explicit insert position from the "+" / number controls (a slide id, or
      // null for "at the beginning"). Undefined => fall back to selected slide.
      afterSlideId,
      getSelectedSlideId,
      setSelectedSlideId,
      editorState,
      api,
      user,
      initialPrompt,
      // Batch-review context: lets multi-slide results open the review grid
      // (truthful previews) before anything is inserted.
      theme,
      SLIDE_TYPES,
      onReviewInserted: () => openDeckOverview?.(),
    });
  };

  const updateCollapseBtn = (btn) => {
    const collapsed = isSlidesCollapsed?.() ?? false;
    btn.textContent = collapsed ? '▶' : '◀';
    btn.title = collapsed
      ? t('editor.slides.expand', 'Expand slide list')
      : t('editor.slides.collapse', 'Collapse slide list');
  };
  const collapseBtn = h('button', {
    class: 'btn btn-secondary slides-collapse-btn',
    text: isSlidesCollapsed?.() ? '▶' : '◀',
    title: isSlidesCollapsed?.()
      ? t('editor.slides.expand', 'Expand slide list')
      : t('editor.slides.collapse', 'Collapse slide list'),
    onclick: () => {
      const next = !(isSlidesCollapsed?.() ?? false);
      setSlidesCollapsed?.(next);
      updateCollapseBtn(collapseBtn);
      // Ensure tooltips / drag tips reflect the current mode.
      try {
        rerenderSlideList?.();
      } catch {
        // ignore
      }
    },
  });

  leftHeader.append(
    h('h2', { text: t('editor.slides.title', 'Slides') }),
    h(
      'div',
      {
        class: 'row',
      },
      [
        collapseBtn,
        h(
          'button',
          {
            class: 'btn btn-primary slides-add-btn is-compact',
            type: 'button',
            'aria-label': t('editor.slides.add', 'Add slide'),
            onclick: () =>
              openSlideTypeModal({ afterSlideId: getSelectedSlideId?.() }),
          },
          [h('span', { text: t('editor.slides.addPlus', '+ Slide') })],
        ),
      ],
    ),
  );

  left.append(leftHeader);
  left.append(searchRow);
  left.append(bulkActionBar);
  left.append(pasteBar);
  left.append(drawerEl);
  leftScroll.append(slideListEl);
  left.append(leftScroll);
  left.append(resizeHandle);

  return {
    leftEl: left,
    slideListEl,
    openSlideTypeModal,
    openSlideLibraryModal,
    openSlideDrawer,
    closeDrawer,
    getSearchQuery: () => searchQuery,
    setSearchQuery: (q, opts) => applySearchNow(q, opts),
    // Drop a queued keystroke render on unmount — it would otherwise fire up to
    // SEARCH_DEBOUNCE_MS later and rerender a torn-down editor.
    detach: cancelPendingSearch,
    setSearchStats,
    updateBulkActionBar,
    pasteFromClipboard,
    copySelectedSlides,
    focusSearch: () => {
      try {
        searchInput.focus();
        searchInput.select?.();
      } catch {
        // ignore
      }
    },
    get slideDrawerOpen() {
      return slideDrawerOpen;
    },
  };
}
