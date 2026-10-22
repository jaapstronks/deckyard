import { lockDocumentScroll } from '../editor-utils.js';
import { t } from '../../../lib/ui-i18n.js';
import { createModal } from '../../../lib/dom/modal.js';
import { icon } from '../../../lib/dom/icons.js';
import { createImageLibraryGrid } from './grid.js';
import { createListPager } from '../../../lib/dom/list-pager.js';
import { createImageLibraryDetail } from './detail.js';
import { createImageLibraryUpload, chooseImageFile } from './upload.js';
import { openImageBatch, chooseImageFiles } from './batch.js';
import { createUnsplashSearch } from './unsplash-search.js';
import { createGiphySearch } from './giphy-search.js';
import { createMediaLibrarySidebar, SECTIONS } from './sidebar.js';
import {
  fetchStockMediaStatus,
  isStockSourceAvailable,
} from '../../../lib/net/stock-media.js';
import { h } from '../../../lib/dom/index.js';
import {
  aiAltTextEnabled,
  featureEnabled,
} from '../../../lib/state/features.js';

// LocalStorage key for persisting last-used section
const STORAGE_KEY_SECTION = 'deckyard.mediaLibrary.lastSection';

/** Images per page in the library grid. */
const IMAGE_PAGE_SIZE = 40;

/** "Recent" is the newest images, one page of them. */
const RECENT_COUNT = 20;

/**
 * The server filter a library section reads (B822): the list is filtered and
 * paged in SQL, never here. "Recent" is the first page of everything.
 * @param {string} section
 * @returns {string}
 */
function serverSection(section) {
  switch (section) {
    case SECTIONS.YOUR_MEDIA:
      return 'mine';
    case SECTIONS.FAVORITES:
      return 'favorites';
    case SECTIONS.LOGOS:
      return 'logos';
    case SECTIONS.ICONS:
      return 'icons';
    default:
      return 'all';
  }
}

/**
 * Get section display info
 * @param {string} section - Section ID
 * @returns {Object} Section info with icon and label
 */
function getSectionInfo(section) {
  const info = {
    [SECTIONS.RECENT]: {
      icon: 'clock',
      label: t('mediaLibrary.section.recent', 'Recent'),
    },
    [SECTIONS.FAVORITES]: {
      icon: 'star',
      label: t('mediaLibrary.section.favorites', 'Favorites'),
    },
    [SECTIONS.YOUR_MEDIA]: {
      icon: 'user',
      label: t('mediaLibrary.section.yourMedia', 'Your Media'),
    },
    [SECTIONS.ALL]: {
      icon: 'folder',
      label: t('mediaLibrary.section.allMedia', 'All Media'),
    },
    [SECTIONS.LOGOS]: {
      icon: 'tag',
      label: t('mediaLibrary.section.logos', 'Logos'),
    },
    [SECTIONS.ICONS]: {
      icon: 'sparkles',
      label: t('mediaLibrary.section.icons', 'Icons'),
    },
  };
  return info[section] || info[SECTIONS.ALL];
}

/**
 * Opens the image library picker modal.
 *
 * With `upload: true` it is the direct upload route from an image field
 * (B579): the OS file dialog comes first, and the modal opens on the chosen
 * file, already uploading. A cancelled dialog opens nothing.
 *
 * @param {Object} options - Picker options
 */
export function openImageLibraryPicker({
  upload = false,
  batch = false,
  ...options
} = {}) {
  if (batch) {
    chooseImageFiles((files) => openImageBatch({ ...options, files }));
    return;
  }
  if (upload) {
    chooseImageFile((file) => openLibraryModal({ ...options, file }));
    return;
  }
  openLibraryModal(options);
}

/**
 * @param {Object} options - Picker options, plus the `file` to start uploading
 */
function openLibraryModal({
  title = t('imageLibrary.title', 'Media Library'),
  allowCaptionCredit = false,
  onPick,
  user,
  api,
  root,
  context = null,
  file = null,
} = {}) {
  const uploadsEnabled = featureEnabled('uploads');
  const libraryOnly = typeof onPick !== 'function';
  const canAiAlt = aiAltTextEnabled();

  const unlockScroll = lockDocumentScroll();
  let closed = false;
  let busy = false;
  let items = [];
  let activeTag = '';
  // Restore last-used section from localStorage, default to ALL
  let activeSection = SECTIONS.ALL;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SECTION);
    if (saved && Object.values(SECTIONS).includes(saved)) {
      // Don't restore external sections (Unsplash/Giphy) as they require stock media status
      if (saved !== SECTIONS.UNSPLASH && saved !== SECTIONS.GIPHY) {
        activeSection = saved;
      }
    }
  } catch {
    // Ignore localStorage errors
  }
  let stockMediaStatus = null;

  const modal = createModal({
    title,
    modalClass: 'image-library-modal',
    fill: true,
    onClose: () => {
      closed = true;
      unlockScroll();
    },
  });
  modal.header.classList.add('media-lib-header');
  const close = () => {
    if (closed) return;
    modal.close();
  };

  // Status line
  const status = h('div', { class: 'help media-lib-status' });
  const setStatus = (text) => {
    status.textContent = String(text || '');
  };

  // Credit checkbox (for caption auto-fill)
  const creditRow = h('label', {
    class: 'row',
    style: 'padding: var(--ps-space-2) var(--ps-space-4);',
  });
  const creditCb = h('input', { type: 'checkbox' });
  creditCb.checked = true;
  creditRow.append(
    creditCb,
    h('div', {
      class: 'help',
      text: t(
        'imageLibrary.creditAutoFill',
        "Auto-fill caption with 'Photo: <photographer>' (only if caption is empty)",
      ),
    }),
  );

  // The tags of the whole library with their counts (`GET /api/image-library/
  // tags`): the sidebar's tag list and the tag inputs' suggestions.
  let tagFacet = [];
  const tagNames = () => tagFacet.map((tag) => tag.name);
  const loadTags = async () => {
    try {
      const resp = await api('/api/image-library/tags');
      tagFacet = Array.isArray(resp?.tags) ? resp.tags : [];
    } catch {
      tagFacet = [];
    }
    sidebarComponent?.render();
  };

  // The list is read page by page under the section, tag and search (D358,
  // B822); "Load more" reads the next page.
  let searchQuery = '';
  const listQuery = (cursor) => {
    const qs = new URLSearchParams();
    const recent = activeSection === SECTIONS.RECENT;
    qs.set('limit', String(recent ? RECENT_COUNT : IMAGE_PAGE_SIZE));
    const section = serverSection(activeSection);
    if (section !== 'all') qs.set('section', section);
    if (activeTag) qs.set('tag', activeTag);
    if (searchQuery.trim()) qs.set('q', searchQuery.trim());
    if (cursor) qs.set('cursor', cursor);
    return `?${qs}`;
  };
  const pager = createListPager({
    fetchPage: async (_params, cursor) => {
      const resp = await api(`/api/image-library${listQuery(cursor)}`);
      return {
        items: Array.isArray(resp?.items) ? resp.items : [],
        // "Recent" is one page by definition.
        nextCursor:
          activeSection === SECTIONS.RECENT ? null : resp?.nextCursor || null,
      };
    },
    onPage: (page, { first }) => {
      items = first ? page : [...items, ...page];
      updateSectionHeader();
      gridComponent.renderGrid();
    },
  });
  const reloadList = async () => {
    try {
      await pager.load({});
    } catch (e) {
      items = [];
      setStatus(String(e?.message || e));
      updateSectionHeader();
      gridComponent.renderGrid();
    }
  };
  // After a create, change or delete: read the list and the tags again.
  const refreshAll = () => Promise.all([reloadList(), loadTags()]);

  // Grid component
  let gridComponent;
  let sidebarComponent;

  const setBusy = (v) => {
    busy = v;
    // Busy blocks Escape and the backdrop too (it always did here).
    modal.setBusy(v);
    if (gridComponent) gridComponent.setDisabled(busy);
  };

  // Handle toggling favorite status
  const handleToggleFavorite = async (item) => {
    if (!user?.email || !item?.id) return;
    try {
      const resp = await api(`/api/image-library/${item.id}/favorite`, {
        method: 'POST',
      });
      // The item's own flag is the only record of the caller's star (D176):
      // the toggle answers with the new state, the grid and the detail view
      // read it straight off the item.
      items = items.map((it) =>
        it?.id === item.id ? { ...it, favorite: resp.favorite } : it,
      );
      // An image this person just unstarred leaves their Favorites.
      if (activeSection === SECTIONS.FAVORITES && !resp.favorite) {
        items = items.filter((it) => it?.id !== item.id);
        updateSectionHeader();
      }
      gridComponent.renderGrid();
    } catch (e) {
      setStatus(String(e?.message || e));
    }
  };

  gridComponent = createImageLibraryGrid({
    items: () => items,
    tags: tagNames,
    pagerEl: pager.el,
    onSearch: (q) => {
      searchQuery = q;
      reloadList();
    },
    onSelectItem: (it) => detailComponent.show(it),
    getActiveTag: () => activeTag,
    setActiveTag: (tag) => {
      activeTag = tag;
      sidebarComponent?.render();
      reloadList();
    },
    // Hide the tag chips row since tags are in sidebar now
    hideTagFilters: true,
    // Allow favoriting if user is logged in
    onToggleFavorite: user ? handleToggleFavorite : null,
  });

  // Detail component
  const detailComponent = createImageLibraryDetail({
    api,
    user,
    items: () => items,
    allTags: tagNames,
    canAiAlt,
    context,
    onPick,
    onClose: close,
    onItemUpdated: (updated) => {
      items = items.map((x) => (x?.id === updated?.id ? updated : x));
      gridComponent.renderGrid();
      loadTags();
    },
    onItemDeleted: (id) => {
      items = items.filter((x) => x?.id !== id);
      updateSectionHeader();
      gridComponent.renderGrid();
      loadTags();
    },
    onToggleFavorite: user ? handleToggleFavorite : null,
    allowCaptionCredit,
    creditCb,
    setStatus,
    setBusy,
    // The pane replaces the list: hide it on show, bring it back on hide.
    // `layout`, `mobileNav` and `showList` are declared below; both callbacks
    // run on a click, long after this call returns.
    onShow: () => {
      layout.hidden = true;
      mobileNav.hidden = true;
    },
    onHide: () => showList(),
  });

  // Upload component
  const uploadComponent = createImageLibraryUpload({
    api,
    user,
    allTags: tagNames,
    canAiAlt,
    context,
    uploadsEnabled,
    onPick,
    onClose: close,
    onItemCreated: () => refreshAll(),
    onShowDetail: (it) => detailComponent.show(it),
    allowCaptionCredit,
    creditCb,
    setStatus,
    setBusy,
    onMultipleFiles: libraryOnly
      ? (files) =>
          openImageBatch({
            api,
            root,
            files,
            onItemsCreated: () => refreshAll(),
          })
      : null,
  });

  // Stock media components (created lazily)
  let unsplashComponent = null;
  let giphyComponent = null;
  let hasUnsplash = false;
  let hasGiphy = false;

  // Handler when stock media item is selected (downloaded to library)
  const handleStockMediaSelect = (libraryItem) => {
    if (onPick) {
      onPick(libraryItem);
    }
    close();
  };

  // Layout containers (defined early so they can be referenced in show/hide)
  const layout = h('div', { class: 'media-lib-layout' });
  const mainContent = h('div', { class: 'media-lib-main' });
  const externalView = h('div', {
    class: 'media-lib-external-view',
    hidden: true,
  });

  // Section header (shows current section name)
  const sectionHeader = h('div', { class: 'media-lib-section-header' });
  const sectionTitle = h('div', { class: 'media-lib-section-title' });
  const sectionCount = h('span', { class: 'media-lib-section-count' });

  const updateSectionHeader = () => {
    const info = getSectionInfo(activeSection);
    sectionTitle.textContent = '';
    if (activeTag) {
      sectionTitle.textContent = `#${activeTag}`;
    } else {
      sectionTitle.append(
        icon(info.icon, { size: 16, className: 'media-lib-section-icon' }),
        ` ${info.label}`,
      );
    }
    // What is loaded; a "+" while the server has more pages.
    sectionCount.textContent = `(${items.length}${pager.hasMore() ? '+' : ''})`;
  };

  sectionHeader.append(sectionTitle, sectionCount);

  // Toolbar with search. There used to be a "+ Upload" button here that did
  // nothing but scroll to the upload panel at the bottom; with that panel now
  // first, the shortcut has nothing left to point at (B210).
  const toolbar = h('div', { class: 'media-lib-toolbar' });
  const searchWrap = h('div', { class: 'media-lib-search-wrap' });
  searchWrap.append(gridComponent.searchField);
  toolbar.append(searchWrap);

  // Assemble library view — upload first, then search and the grid. Uploading
  // is the most common reason this modal opens, and it used to sit under the
  // whole thumbnail grid. The children go through h(), which skips the null
  // of an absent batch entry; a native append() would print it as "null"
  // (B720).
  const libraryView = h('div', { class: 'media-lib-library-view' }, [
    uploadComponent.el,
    uploadsEnabled && user && libraryOnly
      ? h('button', {
          type: 'button',
          class: 'btn btn-secondary image-batch-library-entry',
          text: t('imageLibrary.batch.libraryEntry', 'Upload several images…'),
          onclick: () =>
            chooseImageFiles((files) =>
              openImageBatch({
                api,
                root,
                files,
                onItemsCreated: () => refreshAll(),
              }),
            ),
        })
      : null,
    toolbar,
    sectionHeader,
    gridComponent.grid,
  ]);

  // Handle external section clicks (Unsplash/Giphy)
  const handleExternalSection = (section) => {
    activeSection = section;
    libraryView.hidden = true;
    externalView.hidden = false;
    externalView.replaceChildren();

    if (section === SECTIONS.UNSPLASH && unsplashComponent) {
      externalView.append(unsplashComponent.el);
      unsplashComponent.focus();
    } else if (section === SECTIONS.GIPHY && giphyComponent) {
      externalView.append(giphyComponent.el);
      giphyComponent.init?.();
      giphyComponent.focus();
    }
    setStatus('');

    // Persist section to localStorage
    try {
      localStorage.setItem(STORAGE_KEY_SECTION, section);
    } catch {
      // Ignore localStorage errors
    }
  };

  // Handle library section changes
  const handleSectionChange = (section) => {
    if (section === SECTIONS.UNSPLASH || section === SECTIONS.GIPHY) {
      handleExternalSection(section);
      return;
    }

    activeSection = section;
    libraryView.hidden = false;
    externalView.hidden = true;
    updateSectionHeader();
    setStatus('');
    reloadList();

    // Persist section to localStorage
    try {
      localStorage.setItem(STORAGE_KEY_SECTION, section);
    } catch {
      // Ignore localStorage errors
    }
  };

  // Create sidebar component
  sidebarComponent = createMediaLibrarySidebar({
    user,
    tags: () => tagFacet,
    getActiveSection: () => activeSection,
    setActiveSection: handleSectionChange,
    getActiveTag: () => activeTag,
    setActiveTag: (tag) => {
      activeTag = tag;
      updateSectionHeader();
      reloadList();
    },
    hasUnsplash: false, // Updated after fetching status
    hasGiphy: false,
    onExternalSectionClick: handleExternalSection,
  });

  // Mobile navigation (dropdown for smaller screens)
  const mobileNav = h('div', { class: 'media-lib-mobile-nav' });
  const renderMobileNav = () => {
    mobileNav.replaceChildren();
    const sections = [
      SECTIONS.ALL,
      SECTIONS.RECENT,
      SECTIONS.YOUR_MEDIA,
      SECTIONS.LOGOS,
      SECTIONS.ICONS,
    ];
    if (hasUnsplash) sections.push(SECTIONS.UNSPLASH);
    if (hasGiphy) sections.push(SECTIONS.GIPHY);

    for (const section of sections) {
      if (section === SECTIONS.YOUR_MEDIA && !user?.email) continue;
      const info = getSectionInfo(section);
      const isActive = activeSection === section && !activeTag;
      const btn = h('button', {
        class: `media-lib-mobile-nav-item${isActive ? ' is-active' : ''}`,
        text: info.label,
        onclick: () => {
          activeTag = '';
          handleSectionChange(section);
          renderMobileNav();
          sidebarComponent.render();
        },
      });
      mobileNav.append(btn);
    }
  };

  // The list comes back whenever the detail pane hides (its `onHide`).
  const showList = () => {
    layout.hidden = false;
    mobileNav.hidden = false;
    libraryView.hidden =
      activeSection === SECTIONS.UNSPLASH || activeSection === SECTIONS.GIPHY;
    externalView.hidden = !libraryView.hidden;
    setStatus('');
  };

  // Load data
  const load = async () => {
    setBusy(true);
    setStatus(t('imageLibrary.loading', 'Loading library…'));
    try {
      const [, , statusResp] = await Promise.all([
        pager.load({}),
        loadTags(),
        fetchStockMediaStatus(),
      ]);
      stockMediaStatus = statusResp;

      // Check stock media availability
      hasUnsplash = isStockSourceAvailable(stockMediaStatus, 'unsplash');
      hasGiphy = isStockSourceAvailable(stockMediaStatus, 'giphy');

      // Create stock media components if available
      if (hasUnsplash) {
        unsplashComponent = createUnsplashSearch({
          api,
          onSelect: handleStockMediaSelect,
          setStatus,
          setBusy,
        });
      }
      if (hasGiphy) {
        giphyComponent = createGiphySearch({
          api,
          onSelect: handleStockMediaSelect,
          setStatus,
          setBusy,
        });
      }

      // Update sidebar with stock media availability
      sidebarComponent = createMediaLibrarySidebar({
        user,
        tags: () => tagFacet,
        getActiveSection: () => activeSection,
        setActiveSection: handleSectionChange,
        getActiveTag: () => activeTag,
        setActiveTag: (tag) => {
          if (tag === activeTag) return;
          activeTag = tag;
          updateSectionHeader();
          reloadList();
          sidebarComponent.render();
        },
        hasUnsplash,
        hasGiphy,
        onExternalSectionClick: handleExternalSection,
      });

      // Replace sidebar in DOM
      const oldSidebar = modal.modal.querySelector('.media-lib-sidebar');
      if (oldSidebar) {
        oldSidebar.replaceWith(sidebarComponent.el);
      }

      sidebarComponent.render();
      renderMobileNav();
      updateSectionHeader();
      setStatus('');
      gridComponent.renderGrid();

      // If detail was open before reload, restore it
      const activeId = detailComponent.getActiveId();
      if (activeId) {
        const cur = items.find((x) => x?.id === activeId);
        if (cur) detailComponent.show(cur);
        else detailComponent.hide();
      }
    } catch (e) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // Assemble main content
  mainContent.append(libraryView, externalView);

  // Assemble layout
  layout.append(sidebarComponent.el, mainContent);

  // Assemble modal
  modal.append(status, mobileNav, layout, detailComponent.el);
  if (allowCaptionCredit) modal.append(creditRow);

  // Mount and initialize
  modal.show(root);
  sidebarComponent.render();
  renderMobileNav();
  // On a frame: the focus trap claims initial focus on the next frame, so a
  // synchronous call here would be overridden one frame later.
  if (file) {
    load().then(() => uploadComponent.uploadFile(file));
  } else {
    requestAnimationFrame(() => gridComponent.focus());
    load();
  }
}
