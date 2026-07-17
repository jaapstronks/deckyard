/**
 * Presentation List View
 * Main view for displaying and managing presentations
 *
 * This file orchestrates:
 * - Topbar (search, settings, logout)
 * - Sidebar navigation
 * - View management (home, recent, workspace, etc.)
 * - Bulk actions (multi-select)
 */

import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import {
  readLangMode,
  getSupportedLangs,
  writeLangMode,
} from '../lib/i18n.js';
import { openNewPresentationModal } from './list/modals/new-presentation.js';
import { createCardRenderer, toListItem } from './list/presentation-card.js';
import { createSidebar, createBottomTabs } from './list/sidebar.js';
import { createThemePickerRow } from './list/theme-picker-row.js';
import { createActivityFeed } from './list/overview-activity.js';
import { getFeatures } from '../lib/features.js';
import {
  createHomeView,
  createRecentView,
  createStarterKitsView,
  createWorkspaceView,
  createPrivateView,
  createMyPresentationsView,
  createSharedWithMeView,
  createTrashView,
  createSearchView,
  createSlideLibraryView,
} from './list/views/index.js';
import {
  createSelectionState,
  createBulkActionBar,
} from './list/bulk-action-bar.js';
import { storage } from '../lib/storage.js';
import { createTopbar } from './list/topbar.js';

const LOCAL_STORAGE_KEY_VIEW = 'ps:presentation-list-view';
const SESSION_KEY_FRESH_LOGIN = 'ps:fresh-login-pending';
const VALID_VIEWS = ['home', 'recent', 'starterKits', 'workspace', 'myPresentations', 'sharedWithMe', 'slideLibrary', 'activity', 'trash'];

export async function renderList(root, { nav, user, openSlideLibrary } = {}) {
  const features = getFeatures() || {};
  const shell = h('div', { class: 'app-shell has-sidebar', role: 'application' });
  const detachThumbs = [];
  const aborters = [];
  const detachers = [];
  const openOverlayClosers = new Set();

  // ============================================================
  // CLEANUP HELPERS
  // ============================================================

  const closeAllOverlays = () => {
    for (const close of Array.from(openOverlayClosers)) {
      try { close(); } catch { /* ignore */ }
    }
    openOverlayClosers.clear();
  };

  // ============================================================
  // STATE
  // ============================================================

  let currentView = (() => {
    // Check if this is a fresh login session - if so, reset to 'home'
    try {
      const freshLogin = sessionStorage.getItem(SESSION_KEY_FRESH_LOGIN);
      if (freshLogin === '1') {
        sessionStorage.removeItem(SESSION_KEY_FRESH_LOGIN);
        storage.remove(LOCAL_STORAGE_KEY_VIEW);
        return 'home';
      }
    } catch { /* sessionStorage may not be available */ }

    const raw = storage.get(LOCAL_STORAGE_KEY_VIEW, '').trim();
    return VALID_VIEWS.includes(raw) ? raw : 'home';
  })();

  let unreadCount = 0;

  // ============================================================
  // MODAL WRAPPERS
  // ============================================================

  const openNewPresentationModalWrapper = (preselectedTheme) =>
    openNewPresentationModal({
      h,
      api,
      root,
      nav,
      readLangMode,
      getSupportedLangs,
      writeLangMode,
      preselectedTheme,
    });

  // ============================================================
  // TOPBAR
  // ============================================================

  let searchInput = null;

  const { el: topbar, searchInput: topbarSearchInput } = createTopbar({
    h,
    features,
    api,
    nav,
    user,
    detachers,
    onSearch: (query) => handleSearch(query),
  });
  searchInput = topbarSearchInput;
  shell.append(topbar);

  // ============================================================
  // SIDEBAR & BOTTOM TABS
  // ============================================================

  const sidebar = createSidebar({
    h,
    activeView: currentView,
    unreadCount,
    onViewChange: setView,
    onAction: (key, href) => {
      // Handle action items (e.g., navigate to external routes)
      if (href) {
        nav(href);
      }
    },
    onNewClick: () => openNewPresentationModalWrapper(),
  });
  shell.append(sidebar.el);

  const bottomTabs = createBottomTabs({
    h,
    activeView: currentView,
    unreadCount,
    onViewChange: setView,
  });
  shell.append(bottomTabs.el);

  // ============================================================
  // CONTENT AREA
  // ============================================================

  const content = h('main', { id: 'main-content', class: 'presentation-grid-content', role: 'main' });
  const frame = h('div', { class: 'presentation-grid-frame' });
  content.append(frame);
  shell.append(content);
  root.append(shell);

  // ============================================================
  // LOAD PRESENTATIONS
  // ============================================================

  // Fetch main list and shared presentations in parallel with graceful fallbacks
  const [list, sharedResp] = await Promise.all([
    api('/api/presentations').catch(() => []),
    api('/api/presentations/shared-with-me').catch(() => ({ presentations: [] })),
  ]);

  const workspace = [];
  const starterKits = [];
  const priv = [];

  // Track IDs from main list to avoid duplicates with shared
  const mainListIds = new Set();

  for (const p of Array.isArray(list) ? list : []) {
    mainListIds.add(p.id);
    if (p?.scope === 'workspace') {
      if (p?.isStarterKit) {
        starterKits.push(p);
      } else {
        workspace.push(p);
      }
    } else {
      priv.push(p);
    }
  }

  // Process shared presentations (mark them and exclude duplicates)
  const sharedPresentations = (sharedResp?.presentations || [])
    .filter((p) => !mainListIds.has(p.id))
    .map((p) => ({
      ...p,
      isSharedWithMe: true,
    }));

  const getTimestamp = (p) => {
    // For shared presentations, use sharedAt as the primary date
    const dateStr = p.sharedAt || p.updatedAt || p.createdAt;
    if (!dateStr) return 0;
    const time = new Date(dateStr).getTime();
    return Number.isNaN(time) ? 0 : time;
  };

  const allByDate = [...workspace, ...starterKits, ...priv, ...sharedPresentations].sort((a, b) =>
    getTimestamp(b) - getTimestamp(a)
  );

  // ============================================================
  // SELECTION STATE
  // ============================================================

  const selectionState = createSelectionState();

  const clearSelectionOnViewChange = () => {
    selectionState.clear();
  };

  selectionState.subscribe(() => {
    const cards = frame.querySelectorAll('.presentation-card');
    for (const card of cards) {
      card._updateSelection?.();
    }
  });

  // ============================================================
  // CARD RENDERER
  // ============================================================

  let onDeckDuplicated = null;
  let onDeckClaimed = null;

  const { renderCard } = createCardRenderer({
    api,
    nav,
    onDeckDuplicated: (created) => onDeckDuplicated?.(created),
    onDeckClaimed: (claimed) => onDeckClaimed?.(claimed),
    onTrashRefresh: () => trashViewObj.refresh(),
    detachThumbs,
    aborters,
    selectionState,
  });

  // ============================================================
  // THEME PICKER & ACTIVITY FEED
  // ============================================================

  const themePicker = createThemePickerRow({
    h,
    api,
    onThemeSelect: (theme) => openNewPresentationModalWrapper(theme),
    onShowAll: () => openNewPresentationModalWrapper(),
  });
  detachers.push(() => themePicker.detach?.());

  const activityFeed = createActivityFeed({
    h,
    api,
    onNavigate: (path) => nav?.(path),
    onUnreadCountChange: (count) => {
      unreadCount = count;
      sidebar.updateBadge(count);
      bottomTabs.updateBadge(count);
    },
  });
  activityFeed.fetchUnreadCount();

  // ============================================================
  // BUILD VIEWS
  // ============================================================

  const homeViewObj = createHomeView({
    h,
    api,
    nav,
    renderCard,
    setView,
    allByDate,
    starterKits,
    themePicker,
    unreadCount,
    user,
    onCreate: () => openNewPresentationModalWrapper(),
    onBrowseTemplates: () => setView('starterKits'),
  });

  const recentViewObj = createRecentView({
    h,
    api,
    renderCard,
    allByDate,
  });

  const starterKitsViewObj = createStarterKitsView({
    h,
    api,
    renderCard,
    starterKits,
  });

  const workspaceViewObj = createWorkspaceView({
    h,
    api,
    renderCard,
    workspace,
  });

  const privateViewObj = createPrivateView({
    h,
    api,
    renderCard,
    priv,
    onCreate: () => openNewPresentationModalWrapper(),
    onBrowseTemplates: starterKits.length > 0 ? () => setView('starterKits') : null,
  });

  // All user-authored presentations (private + workspace, excluding shared with me)
  const myPresentations = [...priv, ...workspace, ...starterKits];
  const myPresentationsViewObj = createMyPresentationsView({
    h,
    api,
    renderCard,
    myPresentations,
    onCreate: () => openNewPresentationModalWrapper(),
    onBrowseTemplates: starterKits.length > 0 ? () => setView('starterKits') : null,
  });

  const sharedWithMeViewObj = createSharedWithMeView({
    h,
    api,
    renderCard,
  });

  const trashViewObj = createTrashView({
    h,
    api,
    renderCard,
  });

  const slideLibraryViewObj = createSlideLibraryView({
    api,
    nav,
  });

  // Search view
  let previousView = currentView;
  const searchViewObj = createSearchView({
    h,
    renderCard,
    allPresentations: [...workspace, ...starterKits, ...priv, ...sharedPresentations],
    onClearSearch: () => {
      searchInput.value = '';
      setView(previousView);
    },
  });

  // Load initial data
  themePicker.load();
  homeViewObj.loadActivityPreview();
  homeViewObj.loadPopularPresentations();

  // ============================================================
  // ADD VIEWS TO FRAME
  // ============================================================

  frame.append(
    homeViewObj.el,
    recentViewObj.el,
    starterKitsViewObj.el,
    workspaceViewObj.el,
    privateViewObj.el,
    myPresentationsViewObj.el,
    sharedWithMeViewObj.el,
    trashViewObj.el,
    slideLibraryViewObj.el,
    activityFeed.el,
    searchViewObj.el
  );

  // ============================================================
  // BULK ACTION BAR
  // ============================================================

  const bulkActionBar = createBulkActionBar({
    selectionState,
    api,
    isTrashView: () => currentView === 'trash',
    onBulkDelete: () => nav?.('/app'),
    onBulkRestore: () => trashViewObj.refresh(),
  });
  shell.append(bulkActionBar.el);
  detachers.push(() => bulkActionBar.detach?.());

  // ============================================================
  // VIEW SWITCHING
  // ============================================================

  function setView(viewKey) {
    // Remember previous view for search clear
    if (currentView !== 'search') {
      previousView = currentView;
    }

    currentView = viewKey;

    // Persist non-search views
    if (viewKey !== 'search') {
      storage.set(LOCAL_STORAGE_KEY_VIEW, viewKey);
    }

    clearSelectionOnViewChange();
    bulkActionBar.update?.();

    sidebar.setActiveView(viewKey);
    bottomTabs.setActiveView(viewKey);

    // Toggle view visibility - first remove is-active from all, then add to target
    const views = frame.querySelectorAll('.sidebar-view');
    for (const view of views) {
      view.classList.remove('is-active');
    }
    for (const view of views) {
      if (view.dataset.view === viewKey) {
        view.classList.add('is-active');
      }
    }

    // Load data for specific views
    if (viewKey === 'activity') activityFeed.load();
    if (viewKey === 'sharedWithMe') sharedWithMeViewObj.load();
    if (viewKey === 'trash') trashViewObj.load();
    if (viewKey === 'slideLibrary') slideLibraryViewObj.load();

    // Load tag filters for views that have them
    if (viewKey === 'private') privateViewObj.tagFilter?.load();
    if (viewKey === 'myPresentations') myPresentationsViewObj.tagFilter?.load();
    if (viewKey === 'workspace') workspaceViewObj.tagFilter?.load();
    if (viewKey === 'recent') recentViewObj.tagFilter?.load();
    if (viewKey === 'starterKits') starterKitsViewObj.tagFilter?.load();
  }

  // ============================================================
  // SEARCH
  // ============================================================

  let searchDebounce = null;

  function handleSearch(query) {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      if (query.trim()) {
        searchViewObj.search(query);
        if (currentView !== 'search') {
          setView('search');
        }
      } else if (currentView === 'search') {
        setView(previousView);
      }
    }, 150);
  }

  // ============================================================
  // DECK HANDLERS
  // ============================================================

  onDeckDuplicated = (createdFull) => {
    const created = toListItem(createdFull);
    if (!created?.id) return;

    priv.unshift(created);
    myPresentations.unshift(created);
    privateViewObj.list.prepend(
      renderCard(created, { isWorkspace: false, highlight: true })
    );
    myPresentationsViewObj.list.prepend(
      renderCard(created, { isWorkspace: false, highlight: true })
    );
    recentViewObj.list.prepend(
      renderCard(created, { isWorkspace: false, highlight: true })
    );
    setView('myPresentations');
  };

  onDeckClaimed = (claimedFull) => {
    if (claimedFull?.id) {
      nav?.('/app');
    }
  };

  // ============================================================
  // KEYBOARD SHORTCUTS
  // ============================================================

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    }
  }

  document.addEventListener('keydown', handleKeyDown);
  detachers.push(() => document.removeEventListener('keydown', handleKeyDown));

  // Tag filter detachers
  detachers.push(() => privateViewObj.tagFilter?.detach?.());
  detachers.push(() => myPresentationsViewObj.tagFilter?.detach?.());
  detachers.push(() => myPresentationsViewObj.visibilityFilter?.detach?.());
  detachers.push(() => workspaceViewObj.tagFilter?.detach?.());
  detachers.push(() => recentViewObj.tagFilter?.detach?.());
  detachers.push(() => starterKitsViewObj.tagFilter?.detach?.());

  // ============================================================
  // INITIAL SETUP
  // ============================================================

  // Handle permalink navigation to slide library
  if (openSlideLibrary?.scope && openSlideLibrary?.slideId) {
    setView('slideLibrary');
    slideLibraryViewObj.openSlide(openSlideLibrary.scope, openSlideLibrary.slideId);
  } else {
    setView(currentView);
  }

  // ============================================================
  // CLEANUP
  // ============================================================

  return () => {
    closeAllOverlays();
    for (const d of detachThumbs) {
      try { if (typeof d === 'function') d(); } catch { /* ignore */ }
    }
    for (const d of detachers) {
      try { if (typeof d === 'function') d(); } catch { /* ignore */ }
    }
    for (const a of aborters) {
      try { a?.abort?.(); } catch { /* ignore */ }
    }
  };
}