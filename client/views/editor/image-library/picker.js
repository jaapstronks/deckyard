import { lockDocumentScroll } from '../editor-utils.js';
import { t } from '../../../lib/ui-i18n.js';
import { iconUrl } from '../../../../shared/icon-names.js';
import { createImageLibraryGrid } from './grid.js';
import { createImageLibraryDetail } from './detail.js';
import { createImageLibraryUpload } from './upload.js';
import { createUnsplashSearch } from './unsplash-search.js';
import { createGiphySearch } from './giphy-search.js';
import { createMediaLibrarySidebar, SECTIONS } from './sidebar.js';

// Re-export for backward compatibility
export { readFileAsDataUrl } from './utils.js';

// LocalStorage key for persisting last-used section
const STORAGE_KEY_SECTION = 'deckyard.mediaLibrary.lastSection';

/**
 * Filter items based on the active section
 * @param {Array} items - All items
 * @param {string} section - Active section
 * @param {string} userEmail - Current user's email
 * @returns {Array} Filtered items
 */
function filterBySection(items, section, userEmail) {
  switch (section) {
    case SECTIONS.RECENT:
      // Show last 20 items sorted by creation date (already sorted desc from API)
      return items.slice(0, 20);

    case SECTIONS.YOUR_MEDIA:
      // Filter to items uploaded by the current user
      if (!userEmail) return [];
      return items.filter((it) => it?.uploadedBy === userEmail);

    case SECTIONS.LOGOS:
      // Filter to items with "logo" tag
      return items.filter((it) => {
        const tags = Array.isArray(it?.tags) ? it.tags : [];
        return tags.some((tag) => String(tag).toLowerCase().includes('logo'));
      });

    case SECTIONS.ICONS:
      // Filter to items with "icon" tag
      return items.filter((it) => {
        const tags = Array.isArray(it?.tags) ? it.tags : [];
        return tags.some((tag) => String(tag).toLowerCase().includes('icon'));
      });

    case SECTIONS.FAVORITES:
      // Filter to favorited items (requires favorites data)
      return items.filter((it) => it?.isFavorite);

    case SECTIONS.ALL:
    default:
      return items;
  }
}

/**
 * Get section display info
 * @param {string} section - Section ID
 * @returns {Object} Section info with icon and label
 */
function getSectionInfo(section) {
  const info = {
    [SECTIONS.RECENT]: { icon: 'clock', label: t('mediaLibrary.section.recent', 'Recent') },
    [SECTIONS.FAVORITES]: { icon: 'star', label: t('mediaLibrary.section.favorites', 'Favorites') },
    [SECTIONS.YOUR_MEDIA]: { icon: 'user', label: t('mediaLibrary.section.yourMedia', 'Your Media') },
    [SECTIONS.ALL]: { icon: 'folder', label: t('mediaLibrary.section.allMedia', 'All Media') },
    [SECTIONS.LOGOS]: { icon: 'tag', label: t('mediaLibrary.section.logos', 'Logos') },
    [SECTIONS.ICONS]: { icon: 'sparkles', label: t('mediaLibrary.section.icons', 'Icons') },
  };
  return info[section] || info[SECTIONS.ALL];
}

/**
 * Opens the image library picker modal
 * @param {Object} options - Picker options
 */
export function openImageLibraryPicker({
  title = t('imageLibrary.title', 'Media Library'),
  allowCaptionCredit = false,
  onPick,
  user,
  api,
  h,
  root,
  openOverlayClosers,
  features,
  context = null,
} = {}) {
  const flags = features && typeof features === 'object' ? features : {};
  const uploadsDisabled = !!flags.disableUploads;
  const canAiAlt = !flags.disableAi && !!flags.aiAltText;

  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal image-library-modal' });

  const unlockScroll = lockDocumentScroll();
  let closed = false;
  let busy = false;
  let items = [];
  let favorites = new Set();
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

  const close = () => {
    if (closed) return;
    closed = true;
    unlockScroll();
    openOverlayClosers?.delete?.(close);
    backdrop.remove();
  };
  openOverlayClosers?.add?.(close);

  // Header
  const header = h('div', { class: 'media-lib-header' });
  header.append(
    h('h2', { text: title }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('common.close', 'Close'),
      onclick: () => close(),
    })
  );

  // Status line
  const status = h('div', { class: 'help media-lib-status' });
  const setStatus = (text) => {
    status.textContent = String(text || '');
  };

  // Credit checkbox (for caption auto-fill)
  const creditRow = h('label', { class: 'row', style: 'padding: var(--ps-space-2) var(--ps-space-4);' });
  const creditCb = h('input', { type: 'checkbox' });
  creditCb.checked = true;
  creditRow.append(
    creditCb,
    h('div', {
      class: 'help',
      text: t(
        'imageLibrary.creditAutoFill',
        "Auto-fill caption with 'Photo: <photographer>' (only if caption is empty)"
      ),
    })
  );

  // Get filtered items based on current section and tag
  const getFilteredItems = () => {
    let filtered = filterBySection(items, activeSection, user?.email);
    // Apply tag filter if set
    if (activeTag) {
      filtered = filtered.filter((it) => {
        const tags = Array.isArray(it?.tags) ? it.tags : [];
        return tags.some((tag) => String(tag).toLowerCase() === activeTag.toLowerCase());
      });
    }
    return filtered;
  };

  // Grid component
  let gridComponent;
  let sidebarComponent;

  const setBusy = (v) => {
    busy = v;
    if (gridComponent) gridComponent.setDisabled(busy);
  };

  // Handle toggling favorite status
  const handleToggleFavorite = async (item) => {
    if (!user?.email || !item?.id) return;
    try {
      const resp = await api(`/api/image-library/${item.id}/favorite`, { method: 'POST' });
      // Update the item's isFavorite status in our local array
      items = items.map((it) =>
        it?.id === item.id ? { ...it, isFavorite: resp.isFavorite } : it
      );
      // Update favorites set
      if (resp.isFavorite) {
        favorites.add(item.id);
      } else {
        favorites.delete(item.id);
      }
      sidebarComponent?.render();
      gridComponent.renderGrid();
    } catch (e) {
      setStatus(String(e?.message || e));
    }
  };

  gridComponent = createImageLibraryGrid({
    h,
    items: getFilteredItems,
    onSelectItem: (it) => detailComponent.show(it),
    getActiveTag: () => activeTag,
    setActiveTag: (tag) => {
      activeTag = tag;
      sidebarComponent?.render();
    },
    // Hide the tag chips row since tags are in sidebar now
    hideTagFilters: true,
    // Allow favoriting if user is logged in
    onToggleFavorite: user ? handleToggleFavorite : null,
  });

  // Detail component
  const detailComponent = createImageLibraryDetail({
    h,
    api,
    user,
    items: () => items,
    canAiAlt,
    context,
    onPick,
    onClose: close,
    onItemUpdated: (updated) => {
      items = items.map((x) => (x?.id === updated?.id ? updated : x));
      sidebarComponent?.render();
      gridComponent.renderGrid();
    },
    onItemDeleted: (id) => {
      items = items.filter((x) => x?.id !== id);
      sidebarComponent?.render();
      gridComponent.renderGrid();
    },
    onToggleFavorite: user ? handleToggleFavorite : null,
    allowCaptionCredit,
    creditCb,
    setStatus,
    setBusy,
  });

  // Upload component
  const uploadComponent = createImageLibraryUpload({
    h,
    api,
    user,
    items: () => items,
    canAiAlt,
    context,
    uploadsDisabled,
    onPick,
    onClose: close,
    onItemCreated: (created) => {
      items = [created, ...items];
      sidebarComponent?.render();
      gridComponent.renderGrid();
    },
    onShowDetail: (it) => detailComponent.show(it),
    allowCaptionCredit,
    creditCb,
    setStatus,
    setBusy,
  });

  // Stock media components (created lazily)
  let unsplashComponent = null;
  let giphyComponent = null;
  let hasUnsplash = false;
  let hasGiphy = false;

  // Handler when stock media item is selected (downloaded to library)
  const handleStockMediaSelect = (libraryItem) => {
    items = [libraryItem, ...items];
    sidebarComponent?.render();
    gridComponent.renderGrid();
    if (onPick) {
      onPick(libraryItem);
    }
    close();
  };

  // Layout containers (defined early so they can be referenced in show/hide)
  const layout = h('div', { class: 'media-lib-layout' });
  const mainContent = h('div', { class: 'media-lib-main' });
  const libraryView = h('div', { class: 'media-lib-library-view' });
  const externalView = h('div', { class: 'media-lib-external-view', hidden: true });

  // Section header (shows current section name)
  const sectionHeader = h('div', { class: 'media-lib-section-header' });
  const sectionTitle = h('div', { class: 'media-lib-section-title' });
  const sectionCount = h('span', { class: 'media-lib-section-count' });

  const updateSectionHeader = () => {
    const info = getSectionInfo(activeSection);
    const filtered = getFilteredItems();
    sectionTitle.textContent = '';
    if (activeTag) {
      sectionTitle.textContent = `#${activeTag}`;
    } else {
      const iconImg = document.createElement('img');
      iconImg.className = 'media-lib-section-icon';
      iconImg.src = iconUrl(info.icon);
      iconImg.alt = '';
      iconImg.setAttribute('aria-hidden', 'true');
      sectionTitle.append(iconImg, ` ${info.label}`);
    }
    sectionCount.textContent = `(${filtered.length})`;
  };

  sectionHeader.append(sectionTitle, sectionCount);

  // Toolbar with search and upload button
  const toolbar = h('div', { class: 'media-lib-toolbar' });
  const searchWrap = h('div', { class: 'media-lib-search-wrap' });
  searchWrap.append(gridComponent.searchField);

  const uploadBtn = uploadsDisabled
    ? null
    : h('button', {
        class: 'btn btn-primary',
        text: t('imageLibrary.upload', '+ Upload'),
        onclick: () => {
          // Scroll to upload section
          uploadComponent.element.scrollIntoView({ behavior: 'smooth' });
        },
      });

  toolbar.append(searchWrap);
  if (uploadBtn) toolbar.append(uploadBtn);

  // Assemble library view
  libraryView.append(toolbar, sectionHeader, gridComponent.grid, uploadComponent.element);

  // Handle external section clicks (Unsplash/Giphy)
  const handleExternalSection = (section) => {
    activeSection = section;
    libraryView.hidden = true;
    externalView.hidden = false;
    externalView.innerHTML = '';

    if (section === SECTIONS.UNSPLASH && unsplashComponent) {
      externalView.append(unsplashComponent.element);
      unsplashComponent.focus();
    } else if (section === SECTIONS.GIPHY && giphyComponent) {
      externalView.append(giphyComponent.element);
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
    gridComponent.renderGrid();
    setStatus('');

    // Persist section to localStorage
    try {
      localStorage.setItem(STORAGE_KEY_SECTION, section);
    } catch {
      // Ignore localStorage errors
    }
  };

  // Create sidebar component
  sidebarComponent = createMediaLibrarySidebar({
    h,
    user,
    items: () => items,
    favorites: () => favorites,
    getActiveSection: () => activeSection,
    setActiveSection: handleSectionChange,
    getActiveTag: () => activeTag,
    setActiveTag: (tag) => {
      activeTag = tag;
      updateSectionHeader();
      gridComponent.renderGrid();
    },
    hasUnsplash: false, // Updated after fetching status
    hasGiphy: false,
    onExternalSectionClick: handleExternalSection,
  });

  // Mobile navigation (dropdown for smaller screens)
  const mobileNav = h('div', { class: 'media-lib-mobile-nav' });
  const renderMobileNav = () => {
    mobileNav.innerHTML = '';
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

  // Wire up show/hide between list and detail
  const showList = () => {
    detailComponent.hide();
    layout.hidden = false;
    mobileNav.hidden = false;
    libraryView.hidden = activeSection === SECTIONS.UNSPLASH || activeSection === SECTIONS.GIPHY;
    externalView.hidden = !libraryView.hidden;
    setStatus('');
  };

  // Override detail hide to show list
  const originalHide = detailComponent.hide;
  detailComponent.hide = () => {
    originalHide();
    showList();
  };

  // Override detail show to hide list
  const originalShow = detailComponent.show;
  detailComponent.show = (it) => {
    layout.hidden = true;
    mobileNav.hidden = true;
    originalShow(it);
  };

  // Load data
  const load = async () => {
    setBusy(true);
    setStatus(t('imageLibrary.loading', 'Loading library...'));
    try {
      const [libraryResp, statusResp] = await Promise.all([
        api('/api/image-library'),
        fetch('/api/stock-media/status').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);

      items = Array.isArray(libraryResp?.items) ? libraryResp.items : [];
      stockMediaStatus = statusResp;

      // Check stock media availability
      hasUnsplash = !!(stockMediaStatus?.unsplash?.configured && stockMediaStatus?.unsplash?.enabled);
      hasGiphy = !!(stockMediaStatus?.giphy?.configured && stockMediaStatus?.giphy?.enabled);

      // Create stock media components if available
      if (hasUnsplash) {
        unsplashComponent = createUnsplashSearch({
          h,
          api,
          onSelect: handleStockMediaSelect,
          setStatus,
          setBusy,
        });
      }
      if (hasGiphy) {
        giphyComponent = createGiphySearch({
          h,
          api,
          onSelect: handleStockMediaSelect,
          setStatus,
          setBusy,
        });
      }

      // Update sidebar with stock media availability
      sidebarComponent = createMediaLibrarySidebar({
        h,
        user,
        items: () => items,
        favorites: () => favorites,
        getActiveSection: () => activeSection,
        setActiveSection: handleSectionChange,
        getActiveTag: () => activeTag,
        setActiveTag: (tag) => {
          activeTag = tag;
          updateSectionHeader();
          gridComponent.renderGrid();
          sidebarComponent.render();
        },
        hasUnsplash,
        hasGiphy,
        onExternalSectionClick: handleExternalSection,
      });

      // Replace sidebar in DOM
      const oldSidebar = modal.querySelector('.media-lib-sidebar');
      if (oldSidebar) {
        oldSidebar.replaceWith(sidebarComponent.element);
      }

      sidebarComponent.render();
      renderMobileNav();
      updateSectionHeader();
      setStatus(t('imageLibrary.count', '{count} items', { count: items.length }));
      gridComponent.renderGrid();

      // If detail was open before reload, restore it
      const activeId = detailComponent.getActiveId();
      if (activeId) {
        const cur = items.find((x) => x?.id === activeId);
        if (cur) detailComponent.show(cur);
        else showList();
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
  layout.append(sidebarComponent.element, mainContent);

  // Assemble modal
  modal.append(header, status, mobileNav, layout, detailComponent.element);
  if (allowCaptionCredit) modal.append(creditRow);
  backdrop.append(modal);

  // Event handlers
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && !busy) close();
  });

  const handleKeydown = (e) => {
    if (e.key === 'Escape' && !busy) {
      close();
      window.removeEventListener('keydown', handleKeydown);
    }
  };
  window.addEventListener('keydown', handleKeydown);

  // Mount and initialize
  root.append(backdrop);
  sidebarComponent.render();
  renderMobileNav();
  gridComponent.focus();
  load();
}
