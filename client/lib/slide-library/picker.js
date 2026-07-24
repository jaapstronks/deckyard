/**
 * Slide Library Picker
 * Main orchestrator for the slide library UI
 *
 * Refactored into modules:
 * - slide-library-state.js - State management
 * - slide-library-api.js - API operations
 * - slide-library-modals.js - Lightbox and use-slide modals
 * - slide-library-controls.js - UI controls (scope, view, search, filters)
 */

import { t } from '../ui-i18n.js';
import { confirmModal } from '../dom/modal.js';
import { renderSlideElement } from '../slide-runtime/slide-render.js';
import { loadThemeById } from '../theme/theme.js';
import { cleanStr } from '../../../shared/string-utils.js';
import { moreIcon } from '../dom/icons.js';
import { installDismissOnOutside } from '../dom.js';
import { DEFAULT_THEME_ID } from '../../../shared/constants/themes.js';
import {
  sortByPinnedThenName,
  sortByTrashedThenName,
  filterItems,
  hasContentForLang,
} from './search.js';

import { createSlideLibraryState } from './state.js';
import { createSlideLibraryApi } from './api.js';
import { createSlideLibraryModals } from './modals.js';
import { createSlideLibraryControls } from './controls.js';

export function createSlideLibraryPicker({
  h,
  api,
  themeId = '',
  theme: themeObj = null,
  SLIDE_TYPES = null,
  insertFromLibraryItem,
  allowInsert = true,
  initialScope = 'team',
  initialQuery = '',
  initialLang = 'nl',
  showLanguageSwitch = false,
  onCopySlide = null,
  onNewPresentation = null,
  onSlideOpen = null,
  onSlideClose = null,
  // Compose mode: the picker is embedded in the creation view purely to select
  // slides for a new deck. It suppresses the trash view, the per-card "Use"
  // button and the built-in selection bar's management actions, and reports
  // selection changes via onSelectionChange so the host owns the action bar.
  compose = false,
  onSelectionChange = null,
  // Optional: when provided, the card more-menu gains an "Add to collection"
  // action. Called with (item, scope); the host owns the chooser UI.
  onAddToCollection = null,
} = {}) {
  const themeIdNorm = cleanStr(themeId);
  const themeCache = new Map();

  const notifySelection = () => {
    if (compose) onSelectionChange?.(state.getSelectedItemsInOrder());
  };

  // Initialize state
  const state = createSlideLibraryState({
    initialScope,
    initialQuery,
    initialLang,
  });

  // Theme resolver
  const resolveThemeForItem = async (it) => {
    if (themeObj && typeof themeObj === 'object') return themeObj;
    const tid = cleanStr(it?.themeId || '');
    const key = tid || themeIdNorm || DEFAULT_THEME_ID;
    if (themeCache.has(key)) return themeCache.get(key);
    const loaded = await loadThemeById(key);
    themeCache.set(key, loaded);
    return loaded;
  };

  // Initialize API operations
  const apiOps = createSlideLibraryApi({ api, state, themeIdNorm });

  // Initialize modals
  const modals = createSlideLibraryModals({
    h,
    api,
    state,
    apiOps,
    resolveThemeForItem,
    onSlideOpen,
    onSlideClose,
    onCopySlide,
    onNewPresentation,
  });

  // Initialize controls
  const controls = createSlideLibraryControls({
    h,
    state,
    apiOps,
    SLIDE_TYPES,
    showLanguageSwitch,
  });

  // Selection bar update function (set by renderSlideLibraryPicker)
  let updateSelectionBar = null;

  const makeThumbEl = async (it, { onClickPreview } = {}) => {
    const type = cleanStr(it?.slideType);
    if (!type) return null;
    const slide = modals.makeSlideObj(it);
    const th = document.createElement('div');
    th.className = 'thumb ps-lib-thumb';
    if (onClickPreview) {
      th.style.cursor = 'pointer';
      th.title = t('slideLibrary.action.preview', 'Click to preview');
      th.addEventListener('click', (e) => {
        e.stopPropagation();
        onClickPreview();
      });
    }
    const thTheme = await resolveThemeForItem(it);
    const el = renderSlideElement(slide, { mode: 'thumb', theme: thTheme });
    th.appendChild(el);
    return th;
  };

  const renderList = async (mount, scope, { afterSlideId, onPicked, rerender } = {}) => {
    const items = state.getCache(scope);
    const activeView = state.getView();
    const activeLang = state.getLang();
    const activeTypeFilter = state.getTypeFilter();
    const activeTagFilter = state.getTagFilter();
    const q = state.getQuery();

    let inView = items.filter((it) => {
      const isTrashed = !!(it?.isTrashed || it?.trashedAt);
      return activeView === 'trash' ? isTrashed : !isTrashed;
    });

    // Filter by language when language switch is enabled (browse-only mode)
    if (showLanguageSwitch && activeView !== 'trash') {
      inView = inView.filter((it) => hasContentForLang(it, activeLang));
    }

    // Filter by tags first (if any are selected)
    let tagFiltered = inView;
    if (activeView !== 'trash' && activeTagFilter.length > 0) {
      tagFiltered = inView.filter((it) => {
        const itemTagNames = Array.isArray(it?.tags)
          ? it.tags.map((t) => (t?.name || t || '').toLowerCase())
          : [];
        return activeTagFilter.every((filterTag) =>
          itemTagNames.includes(filterTag.toLowerCase())
        );
      });
    }

    // Apply sorting first, then filtering (with type filter and search)
    const sorted = activeView === 'trash' ? sortByTrashedThenName(tagFiltered) : sortByPinnedThenName(tagFiltered);
    const filtered = filterItems(sorted, q, {
      labelForType: controls.typeLabel,
      typeFilter: activeView !== 'trash' ? activeTypeFilter : '',
    });

    if (!filtered.length) {
      mount.append(
        h('div', {
          class: 'help ps-lib-empty',
          text:
            activeView === 'trash'
              ? t('slideLibrary.empty.trash', 'Trash is empty.')
              : scope === 'team'
                ? t('slideLibrary.empty.team', 'No slides in the team library yet.')
                : t('slideLibrary.empty.personal', 'No slides in your personal library yet.'),
        })
      );
      return;
    }

    const grid = h('div', { class: 'ps-lib-grid' });
    for (const it of filtered) {
      const card = await renderCard(it, scope, { afterSlideId, onPicked, rerender });
      grid.append(card);
    }
    mount.append(grid);
  };

  const renderCard = async (it, scope, { afterSlideId, onPicked, rerender } = {}) => {
    const fav = scope === 'team' ? !!it?.isFavorite : !!it?.favorite;
    const type = cleanStr(it?.slideType);
    const insertDisabled = type === 'follow-invite-slide';
    const isSelected = state.isSelected(it.id);
    const activeView = state.getView();

    const card = h('div', {
      class: `ps-lib-card ${fav && activeView !== 'trash' ? 'is-favorite' : ''} ${isSelected ? 'is-selected' : ''}`,
      'data-id': it.id,
    });

    // Thumbnail wrapper with overlay buttons
    const thumbWrap = h('div', { class: 'ps-lib-thumb-wrap' });

    // Thumbnail preview (clickable to open lightbox)
    try {
      const thumb = await makeThumbEl(it, {
        onClickPreview: () => modals.openLightbox(it, { rerender }),
      });
      if (thumb) thumbWrap.append(thumb);
    } catch {
      // ignore thumb render errors
    }

    // Overlay for buttons on the thumbnail
    if (activeView !== 'trash') {
      const overlay = renderCardOverlay(it, scope, card, { rerender });
      thumbWrap.append(overlay);
    }

    card.append(thumbWrap);

    // Card content
    const content = renderCardContent(it, scope, type, { afterSlideId, onPicked, insertDisabled, rerender });
    card.append(content);

    return card;
  };

  const renderCardOverlay = (it, scope, card, { rerender } = {}) => {
    const fav = scope === 'team' ? !!it?.isFavorite : !!it?.favorite;
    const isSelected = state.isSelected(it.id);
    const overlay = h('div', { class: 'ps-lib-thumb-overlay' });

    // Selection checkbox
    const selectCheckbox = h('label', {
      class: `ps-lib-select-checkbox ${isSelected ? 'is-checked' : ''}`,
      onclick: (e) => e.stopPropagation(),
    });
    const checkbox = h('input', {
      type: 'checkbox',
      checked: isSelected,
      'aria-label': t('slideLibrary.action.select', 'Select slide'),
      onchange: () => {
        state.toggleSelection(it);
        card.classList.toggle('is-selected', state.isSelected(it.id));
        selectCheckbox.classList.toggle('is-checked', state.isSelected(it.id));
        updateSelectionBar?.();
        notifySelection();
      },
    });
    selectCheckbox.append(checkbox);
    overlay.append(selectCheckbox);

    // Favorite button
    const favBtn = h('button', {
      class: `ps-lib-overlay-btn ps-lib-fav-btn ${fav ? 'is-on' : ''}`,
      type: 'button',
      title: fav ? t('slideLibrary.action.unfavorite', 'Unfavorite') : t('slideLibrary.action.favorite', 'Favorite'),
      text: fav ? '★' : '☆',
      onclick: (e) => {
        e.stopPropagation();
        apiOps.toggleFavorite(scope, it, { rerender });
      },
    });
    overlay.append(favBtn);

    // More menu
    const moreDetails = renderMoreMenu(it, scope, { rerender });
    overlay.append(moreDetails);

    return overlay;
  };

  const renderMoreMenu = (it, scope, { rerender } = {}) => {
    const moreDetails = h('details', { class: 'dropdown ps-lib-more-dropdown' });
    const moreSummary = h('summary', {
      class: 'ps-lib-overlay-btn ps-lib-more-btn dropdown-trigger',
      title: t('common.moreOptions', 'More options'),
      onclick: (e) => e.stopPropagation(),
    });
    moreSummary.appendChild(moreIcon({ size: 14 }));

    const moreMenu = h('div', { class: 'dropdown-menu' });

    // Add to team library (only for personal scope)
    if (scope === 'personal') {
      const pushBtn = h('button', {
        class: 'dropdown-item',
        type: 'button',
        text: t('slideLibrary.action.pushToTeam', 'Add to team library'),
        onclick: () => {
          moreDetails.open = false;
          apiOps.pushToTeam(it);
        },
      });
      moreMenu.append(pushBtn);
    }

    // Add to collection (host owns the chooser; only shown when wired)
    if (typeof onAddToCollection === 'function') {
      const addToCollectionBtn = h('button', {
        class: 'dropdown-item',
        type: 'button',
        text: t('slideLibrary.action.addToCollection', 'Add to collection'),
        onclick: () => {
          moreDetails.open = false;
          onAddToCollection(it, scope);
        },
      });
      moreMenu.append(addToCollectionBtn);
    }

    // Move to trash
    const trashBtn = h('button', {
      class: 'dropdown-item is-danger',
      type: 'button',
      text: t('slideLibrary.action.trash', 'Move to trash'),
      onclick: async () => {
        moreDetails.open = false;
        const ok = await confirmModal(h, document.body, {
          title: t('slideLibrary.action.trash', 'Move to trash'),
          message: t('slideLibrary.action.trash.confirm', 'Move this slide to trash?'),
          confirmLabel: t('slideLibrary.action.trash', 'Move to trash'),
          danger: true,
        });
        if (!ok) return;
        await apiOps.setTrashed(scope, it, true, { rerender });
      },
    });
    moreMenu.append(trashBtn);

    moreDetails.append(moreSummary, moreMenu);

    // Position menu when opened
    moreDetails.addEventListener('toggle', () => {
      if (moreDetails.open) {
        const rect = moreSummary.getBoundingClientRect();
        const menuHeight = moreMenu.offsetHeight || 80;
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceAbove > spaceBelow && spaceAbove >= menuHeight) {
          moreMenu.style.top = 'auto';
          moreMenu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        } else {
          moreMenu.style.top = `${rect.bottom + 4}px`;
          moreMenu.style.bottom = 'auto';
        }
        moreMenu.style.right = `${window.innerWidth - rect.right}px`;
      }
    });

    installDismissOnOutside({
      rootEl: moreDetails,
      isOpen: () => !!moreDetails.open,
      close: () => { moreDetails.open = false; },
    });

    return moreDetails;
  };

  const renderCardContent = (it, scope, type, { afterSlideId, onPicked, insertDisabled, rerender } = {}) => {
    const activeView = state.getView();
    const content = h('div', { class: 'ps-lib-card-content' });
    const meta = h('div', { class: 'ps-lib-meta' });

    meta.append(
      h('div', { class: 'ps-lib-name', text: cleanStr(it?.name) || 'Untitled' }),
      h('div', { class: 'ps-lib-sub', text: controls.typeLabel(type || '') })
    );

    // Description (truncated)
    const desc = cleanStr(it?.description);
    if (desc) {
      const truncatedDesc = desc.length > 80 ? desc.slice(0, 77) + '...' : desc;
      meta.append(h('div', { class: 'ps-lib-description', text: truncatedDesc }));
    }

    // Tags
    const itemTags = Array.isArray(it?.tags) ? it.tags : [];
    if (itemTags.length > 0) {
      const tagsWrap = h('div', { class: 'ps-lib-tags' });
      const visibleTags = itemTags.slice(0, 3);
      for (const tag of visibleTags) {
        tagsWrap.append(h('span', { class: 'ps-lib-tag', text: tag.name || tag }));
      }
      if (itemTags.length > 3) {
        tagsWrap.append(h('span', { class: 'ps-lib-tag ps-lib-tag-more', text: `+${itemTags.length - 3}` }));
      }
      meta.append(tagsWrap);
    }

    content.append(meta);

    // Action buttons
    if (allowInsert && activeView !== 'trash') {
      const insertBtn = h('button', {
        class: 'btn btn-primary is-compact ps-lib-action-btn',
        type: 'button',
        text: t('slideLibrary.action.insert', 'Insert'),
        disabled: insertDisabled,
        onclick: () => {
          if (insertDisabled) return;
          insertFromLibraryItem?.(it, { afterSlideId });
          onPicked?.();
        },
      });
      content.append(insertBtn);
    }

    if (!allowInsert && !compose && activeView !== 'trash') {
      const useBtn = h('button', {
        class: 'btn btn-primary is-compact ps-lib-action-btn',
        type: 'button',
        text: t('slideLibrary.action.use', 'Use'),
        onclick: () => modals.openUseSlideModal(it),
      });
      content.append(useBtn);
    }

    if (activeView === 'trash') {
      const restoreBtn = h('button', {
        class: 'btn btn-secondary is-compact ps-lib-action-btn',
        type: 'button',
        text: t('slideLibrary.action.restore', 'Restore'),
        onclick: () => apiOps.setTrashed(scope, it, false, { rerender }),
      });
      content.append(restoreBtn);
    }

    return content;
  };

  const renderSelectionBar = (mount, { afterSlideId, onPicked, rerender } = {}) => {
    const selectionBar = h('div', { class: 'ps-lib-selection-bar' });

    updateSelectionBar = () => {
      selectionBar.innerHTML = '';
      const count = state.getSelectedCount();

      if (count === 0) {
        selectionBar.classList.remove('is-visible');
        return;
      }

      selectionBar.classList.add('is-visible');

      // Left side: count and clear
      const leftSide = h('div', { class: 'ps-lib-selection-left' });
      const countText = h('span', {
        class: 'ps-lib-selection-count',
        text: t('slideLibrary.selection.count', '{count} selected', { count: String(count) }),
      });
      const clearBtn = h('button', {
        class: 'ps-lib-selection-clear-btn',
        type: 'button',
        text: '×',
        onclick: () => {
          state.clearSelection();
          mount.querySelectorAll('.ps-lib-card').forEach((card) => {
            card.classList.remove('is-selected');
            const cb = card.querySelector('.ps-lib-select-checkbox input');
            if (cb) cb.checked = false;
            const label = card.querySelector('.ps-lib-select-checkbox');
            if (label) label.classList.remove('is-checked');
          });
          updateSelectionBar();
        },
      });
      leftSide.append(countText, clearBtn);

      // Action buttons
      const actions = h('div', { class: 'ps-lib-selection-actions' });

      if (allowInsert) {
        const insertAllBtn = h('button', {
          class: 'btn btn-primary is-compact',
          type: 'button',
          text: t('slideLibrary.selection.insertAll', 'Insert {count} slides', { count: String(count) }),
          onclick: async () => {
            const items = state.getSelectedItems();
            for (const item of items) {
              insertFromLibraryItem?.(item, { afterSlideId });
            }
            state.clearSelection();
            onPicked?.();
          },
        });
        actions.append(insertAllBtn);
      } else if (onNewPresentation) {
        const newPresBtn = h('button', {
          class: 'btn btn-primary is-compact',
          type: 'button',
          text: t('slideLibrary.selection.newPresentation', 'New presentation'),
          onclick: () => {
            const items = state.getSelectedItems();
            onNewPresentation?.(items);
            state.clearSelection();
            updateSelectionBar();
          },
        });
        actions.append(newPresBtn);
      }

      // Add to team library
      if (state.getScope() === 'personal' && state.getView() !== 'trash') {
        const pushToTeamBtn = h('button', {
          class: 'btn btn-secondary is-compact',
          type: 'button',
          text: t('slideLibrary.selection.addToTeam', 'Add to team library'),
          onclick: async () => {
            const items = state.getSelectedItems();
            await apiOps.pushMultipleToTeam(items, { rerender });
            state.clearSelection();
            rerender();
          },
        });
        actions.append(pushToTeamBtn);
      }

      // Move to trash
      if (state.getView() !== 'trash') {
        const trashBtn = h('button', {
          class: 'btn btn-secondary is-compact is-danger-text',
          type: 'button',
          text: t('slideLibrary.selection.trash', 'Move to trash'),
          onclick: async () => {
            const items = state.getSelectedItems();
            const ok = await confirmModal(h, document.body, {
              title: t('slideLibrary.selection.trash', 'Move to trash'),
              message: t('slideLibrary.selection.trashConfirm', 'Move {count} slide(s) to trash?', { count: String(items.length) }),
              confirmLabel: t('slideLibrary.selection.trash', 'Move to trash'),
              danger: true,
            });
            if (!ok) return;
            for (const item of items) {
              await apiOps.setTrashed(state.getScope(), item, true, {});
            }
            state.clearSelection();
            rerender();
          },
        });
        actions.append(trashBtn);
      }

      selectionBar.append(leftSide, actions);
    };

    return selectionBar;
  };

  const renderSlideLibraryPicker = async (
    mount,
    { afterSlideId, onPicked, scope: scopeOverride } = {}
  ) => {
    // Optional one-shot scope override (e.g. the insert picker's per-scope
    // "See all"): switch the active scope before rendering, then let the
    // picker's own state drive subsequent re-renders.
    if (scopeOverride === 'team' || scopeOverride === 'personal') state.setScope(scopeOverride);
    mount.innerHTML = '';

    const header = h('div', { class: 'ps-lib-header' });
    const headerRow = h('div', { class: 'ps-lib-header-row' });
    const filtersRow = h('div', { class: 'ps-lib-filters-row' });
    const listContainer = h('div', { class: 'ps-lib-list-container' });

    // Full rerender
    const rerender = () => {
      state.resetFilters();
      renderSlideLibraryPicker(mount, { afterSlideId, onPicked });
    };

    // List-only rerender
    const rerenderList = async () => {
      listContainer.innerHTML = '';
      const scope = state.getScope();
      if (state.isLoading(scope)) {
        listContainer.append(h('div', { class: 'help', text: t('common.loading', 'Loading…') }));
        return;
      }
      await renderList(listContainer, scope, { afterSlideId, onPicked, rerender });
    };

    // Header controls
    controls.renderScopeControls(headerRow, rerender);
    // Trash is a management view; hide it when composing a new deck.
    if (!compose) controls.renderViewControls(headerRow, rerender);
    controls.renderLangControls(headerRow, { rerenderList });
    controls.renderSearch(headerRow, { rerenderList });

    const scope = state.getScope();
    header.append(headerRow);

    // Filters row
    if (state.getView() !== 'trash') {
      controls.renderTypeFilters(filtersRow, scope, { rerenderList });
      if (filtersRow.children.length > 0) {
        header.append(filtersRow);
      }
    }

    // Selection bar — in compose mode the host (creation view) owns the action
    // bar, so we skip the built-in one (and its management actions).
    if (compose) {
      mount.append(header, listContainer);
      // Scope/view rerenders clear the selection; keep the host in sync.
      notifySelection();
    } else {
      const selectionBar = renderSelectionBar(mount, { afterSlideId, onPicked, rerender });
      mount.append(header, listContainer, selectionBar);
      updateSelectionBar();
    }

    // Load data if needed
    if (!state.getCache(scope).length && !state.isLoading(scope)) {
      try {
        await apiOps.fetchScope(scope);
      } catch {
        // ignore
      }
    }

    if (state.isLoading(scope)) {
      listContainer.append(h('div', { class: 'help', text: t('common.loading', 'Loading…') }));
      return;
    }

    await renderList(listContainer, scope, { afterSlideId, onPicked, rerender });
  };

  const openSlideById = async (scope, slideId) => {
    const s = scope === 'team' ? 'team' : 'personal';
    state.setScope(s);

    if (!state.getCache(s).length && !state.isLoading(s)) {
      await apiOps.fetchScope(s);
    }

    const item = state.getCache(s).find((it) => it.id === slideId);
    if (item) {
      await modals.openLightbox(item, { updateUrl: false });
    }
  };

  // Re-sync one card's checkbox UI to the selection state (no-op if not shown).
  const syncCardChecked = (id, mount, selected) => {
    const card = (mount || document).querySelector?.(`.ps-lib-card[data-id="${id}"]`);
    if (!card) return;
    card.classList.toggle('is-selected', selected);
    const cb = card.querySelector('.ps-lib-select-checkbox input');
    if (cb) cb.checked = selected;
    const label = card.querySelector('.ps-lib-select-checkbox');
    if (label) label.classList.toggle('is-checked', selected);
  };

  // Deselect a single item by id (used by the compose tray's remove button).
  const deselectItem = (id, mount) => {
    state.deselect(id);
    syncCardChecked(id, mount, false);
    notifySelection();
  };

  // Clear the whole selection and re-sync visible cards.
  const clearSelection = (mount) => {
    const ids = [...state.getSelectedIds()];
    state.clearSelection();
    for (const id of ids) syncCardChecked(id, mount, false);
    notifySelection();
  };

  return {
    renderSlideLibraryPicker,
    setState: state.setState,
    getActiveLang: state.getLang,
    getSelectedItems: state.getSelectedItemsInOrder,
    deselectItem,
    clearSelection,
    openSlideById,
  };
}