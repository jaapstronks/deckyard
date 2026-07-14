import { t } from '../../../lib/ui-i18n.js';
import { iconUrl } from '../../../../shared/icon-names.js';

/**
 * Navigation sections for the media library sidebar
 */
export const SECTIONS = {
  ALL: 'all',
  RECENT: 'recent',
  FAVORITES: 'favorites',
  YOUR_MEDIA: 'your-media',
  LOGOS: 'logos',
  ICONS: 'icons',
  UNSPLASH: 'unsplash',
  GIPHY: 'giphy',
};

/**
 * Section configuration with icons and labels
 */
const SECTION_CONFIG = {
  [SECTIONS.RECENT]: {
    icon: 'clock',
    labelKey: 'mediaLibrary.section.recent',
    labelDefault: 'Recent',
    group: 'main',
  },
  [SECTIONS.FAVORITES]: {
    icon: 'star',
    labelKey: 'mediaLibrary.section.favorites',
    labelDefault: 'Favorites',
    group: 'main',
  },
  [SECTIONS.YOUR_MEDIA]: {
    icon: 'user',
    labelKey: 'mediaLibrary.section.yourMedia',
    labelDefault: 'Your Media',
    group: 'main',
  },
  [SECTIONS.ALL]: {
    icon: 'folder',
    labelKey: 'mediaLibrary.section.allMedia',
    labelDefault: 'All Media',
    group: 'main',
  },
  [SECTIONS.LOGOS]: {
    icon: 'tag',
    labelKey: 'mediaLibrary.section.logos',
    labelDefault: 'Logos',
    group: 'tags',
  },
  [SECTIONS.ICONS]: {
    icon: 'sparkles',
    labelKey: 'mediaLibrary.section.icons',
    labelDefault: 'Icons',
    group: 'tags',
  },
  [SECTIONS.UNSPLASH]: {
    icon: 'camera',
    labelKey: 'stockMedia.tabs.unsplash',
    labelDefault: 'Unsplash',
    group: 'external',
  },
  [SECTIONS.GIPHY]: {
    icon: 'clapperboard',
    labelKey: 'stockMedia.tabs.giphy',
    labelDefault: 'Giphy',
    group: 'external',
  },
};

/**
 * Get tag frequency counts from items
 * @param {Array} items - Image library items
 * @returns {Map<string, number>} Tag to count map
 */
export function getTagFrequency(items) {
  const freq = new Map();
  for (const item of items) {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    for (const tag of tags) {
      const t0 = String(tag || '').trim().toLowerCase();
      if (t0) {
        freq.set(t0, (freq.get(t0) || 0) + 1);
      }
    }
  }
  return freq;
}

/**
 * Get top N tags sorted by frequency
 * @param {Array} items - Image library items
 * @param {number} limit - Maximum tags to return
 * @returns {Array<{tag: string, count: number}>} Top tags with counts
 */
export function getTopTags(items, limit = 10) {
  const freq = getTagFrequency(items);
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

/**
 * Creates the media library sidebar component
 * @param {Object} options - Component options
 * @returns {Object} Sidebar component API
 */
export function createMediaLibrarySidebar({
  h,
  user,
  items,
  favorites,
  getActiveSection,
  setActiveSection,
  getActiveTag,
  setActiveTag,
  hasUnsplash,
  hasGiphy,
  onExternalSectionClick,
} = {}) {
  const sidebar = h('aside', { class: 'media-lib-sidebar' });

  const renderSidebar = () => {
    sidebar.innerHTML = '';

    const activeSection = getActiveSection();
    const activeTag = getActiveTag();
    const currentItems = items();
    const userEmail = user?.email || '';

    // Create nav item helper
    const createNavItem = (sectionId, config, extraClass = '') => {
      const isActive = activeSection === sectionId && !activeTag;
      const btn = h('button', {
        class: `media-lib-nav-item${isActive ? ' is-active' : ''}${extraClass ? ' ' + extraClass : ''}`,
        type: 'button',
        onclick: () => {
          setActiveTag('');
          if (sectionId === SECTIONS.UNSPLASH || sectionId === SECTIONS.GIPHY) {
            onExternalSectionClick?.(sectionId);
          } else {
            setActiveSection(sectionId);
          }
          renderSidebar();
        },
      });

      const iconSpan = h('img', { class: 'media-lib-nav-icon', src: iconUrl(config.icon), alt: '', 'aria-hidden': 'true' });
      const labelSpan = h('span', { class: 'media-lib-nav-label', text: t(config.labelKey, config.labelDefault) });

      btn.append(iconSpan, labelSpan);
      return btn;
    };

    // Main navigation group
    const mainNav = h('nav', { class: 'media-lib-nav-group' });

    // Add main sections
    mainNav.append(createNavItem(SECTIONS.RECENT, SECTION_CONFIG[SECTIONS.RECENT]));
    mainNav.append(createNavItem(SECTIONS.FAVORITES, SECTION_CONFIG[SECTIONS.FAVORITES]));

    // Only show "Your Media" if user is logged in
    if (userEmail) {
      mainNav.append(createNavItem(SECTIONS.YOUR_MEDIA, SECTION_CONFIG[SECTIONS.YOUR_MEDIA]));
    }

    mainNav.append(createNavItem(SECTIONS.ALL, SECTION_CONFIG[SECTIONS.ALL]));
    sidebar.append(mainNav);

    // Tag-based quick filters (Logos, Icons)
    const tagsNav = h('nav', { class: 'media-lib-nav-group' });
    const tagDivider = h('div', { class: 'media-lib-nav-divider' });
    sidebar.append(tagDivider, tagsNav);

    tagsNav.append(createNavItem(SECTIONS.LOGOS, SECTION_CONFIG[SECTIONS.LOGOS]));
    tagsNav.append(createNavItem(SECTIONS.ICONS, SECTION_CONFIG[SECTIONS.ICONS]));

    // External sources (Unsplash, Giphy)
    if (hasUnsplash || hasGiphy) {
      const externalNav = h('nav', { class: 'media-lib-nav-group' });
      const externalDivider = h('div', { class: 'media-lib-nav-divider' });
      sidebar.append(externalDivider, externalNav);

      if (hasUnsplash) {
        externalNav.append(createNavItem(SECTIONS.UNSPLASH, SECTION_CONFIG[SECTIONS.UNSPLASH]));
      }
      if (hasGiphy) {
        externalNav.append(createNavItem(SECTIONS.GIPHY, SECTION_CONFIG[SECTIONS.GIPHY]));
      }
    }

    // Popular tags section
    const topTags = getTopTags(currentItems, 8);
    if (topTags.length > 0) {
      const tagsDivider = h('div', { class: 'media-lib-nav-divider' });
      const tagsHeader = h('div', { class: 'media-lib-nav-header', text: t('mediaLibrary.tags', 'Tags') });
      const tagsGroup = h('nav', { class: 'media-lib-nav-group media-lib-tags-nav' });

      for (const { tag, count } of topTags) {
        const isActive = activeTag === tag;
        const btn = h('button', {
          class: `media-lib-nav-item media-lib-tag-nav${isActive ? ' is-active' : ''}`,
          type: 'button',
          onclick: () => {
            setActiveTag(isActive ? '' : tag);
            setActiveSection(SECTIONS.ALL);
            renderSidebar();
          },
        });

        const labelSpan = h('span', { class: 'media-lib-nav-label', text: `#${tag}` });
        const countSpan = h('span', { class: 'media-lib-tag-count', text: String(count) });

        btn.append(labelSpan, countSpan);
        tagsGroup.append(btn);
      }

      sidebar.append(tagsDivider, tagsHeader, tagsGroup);
    }
  };

  return {
    element: sidebar,
    render: renderSidebar,
  };
}
