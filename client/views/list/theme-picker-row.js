/**
 * Theme quick-picker row component.
 * Displays theme thumbnails for quick new presentation creation.
 */

import { t } from '../../lib/ui-i18n.js';
import { loadThemeById } from '../../lib/theme.js';
import { renderSlideElement } from '../../lib/slide-render.js';
import { attachThumbScale } from '../../lib/thumb-scale.js';

/**
 * Create a real slide thumbnail preview for a theme.
 * @param {Object} theme - Full theme object
 * @param {Function} h - DOM helper function
 * @param {Function[]} detachCallbacks - Array to collect cleanup functions
 * @returns {HTMLElement} Preview element
 */
function createThemePreview(theme, h, detachCallbacks) {
  const preview = h('div', { class: 'theme-picker-preview' });
  const thumb = h('div', { class: 'thumb theme-picker-thumb' });
  preview.append(thumb);

  // Determine title slide type from theme or default
  const titleSlideType = theme?.defaultTitleSlide || 'title-slide';

  // Create sample title slide content
  const sampleSlide = {
    id: 'theme-preview',
    type: titleSlideType,
    content: {
      title: theme?.label || 'Theme Preview',
      subtitle: '',
      background: 'lime',
    },
  };

  try {
    const slideEl = renderSlideElement(sampleSlide, { mode: 'thumb', theme });
    thumb.append(slideEl);
    // Attach scale observer for proper sizing
    const detach = attachThumbScale(thumb, { virtualWidth: 1600 });
    detachCallbacks.push(detach);
  } catch (err) {
    // Fallback: show theme name if rendering fails
    thumb.append(
      h('div', {
        class: 'theme-picker-fallback',
        text: theme?.label || 'Theme',
      })
    );
    // eslint-disable-next-line no-console
    console.warn('[theme-picker] Failed to render preview:', err);
  }

  return preview;
}

/**
 * Create the theme quick-picker row component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper function
 * @param {Function} options.api - API function
 * @param {Function} options.onThemeSelect - Callback when theme is selected
 * @param {Function} options.onShowAll - Callback to show all themes
 * @param {number} options.maxVisible - Maximum themes to show (default: 5)
 * @returns {Object} { el, load, detach }
 */
export function createThemePickerRow({ h, api, onThemeSelect, onShowAll, maxVisible = 5 }) {
  const el = h('div', { class: 'theme-picker-row' });
  const detachCallbacks = [];

  // Header
  const header = h('div', { class: 'theme-picker-header' });
  const titleWrap = h('div');
  const title = h('div', {
    class: 'theme-picker-title',
    text: t('list.theme.quickStart', 'Quick start'),
  });
  const subtitle = h('div', {
    class: 'theme-picker-subtitle',
    text: t('list.theme.pickTheme', 'Pick a theme to create a new presentation'),
  });
  titleWrap.append(title, subtitle);

  const moreBtn = h('button', {
    class: 'theme-picker-more',
    type: 'button',
    text: t('list.theme.browseAll', 'Browse all themes'),
    onclick: () => onShowAll?.(),
  });

  header.append(titleWrap, moreBtn);

  // Theme list container
  const list = h('div', { class: 'theme-picker-list' });

  // Loading state
  const loading = h('div', {
    class: 'theme-picker-loading',
    text: t('list.theme.loading', 'Loading themes...'),
  });

  el.append(header, loading);

  let themes = [];
  let loadedThemes = [];

  /**
   * Load and render themes.
   */
  async function load() {
    try {
      const response = await api('/api/themes');
      const themeList = Array.isArray(response?.themes) ? response.themes : [];
      themes = themeList;

      // Clear loading, show list
      loading.remove();
      el.append(list);

      // Load full theme data and render previews
      const visibleThemes = themeList.slice(0, maxVisible);

      for (const themeInfo of visibleThemes) {
        try {
          // Load full theme data
          const fullTheme = await loadThemeById(themeInfo.id);
          loadedThemes.push(fullTheme);

          const item = h('button', {
            class: 'theme-picker-item',
            type: 'button',
            title: fullTheme?.label || themeInfo.label || t('list.theme.unnamed', 'Unnamed theme'),
            onclick: () => onThemeSelect?.(themeInfo),
          });

          const preview = createThemePreview(fullTheme, h, detachCallbacks);
          const name = h('span', {
            class: 'theme-picker-name',
            text: fullTheme?.label || themeInfo.label || t('list.theme.unnamed', 'Unnamed theme'),
          });

          item.append(preview, name);
          list.append(item);
        } catch (err) {
          // Skip themes that fail to load
          // eslint-disable-next-line no-console
          console.warn(`[theme-picker] Failed to load theme ${themeInfo.id}:`, err);
        }
      }

      // "More" button if there are more themes
      if (themeList.length > maxVisible) {
        const moreItem = h('button', {
          class: 'theme-picker-item is-more',
          type: 'button',
          title: t('list.theme.showMore', 'Show more themes'),
          onclick: () => onShowAll?.(),
        });

        const moreIcon = h('span', {
          class: 'theme-picker-more-icon',
          text: '+',
        });
        const moreLabel = h('span', {
          class: 'theme-picker-more-label',
          text: t('list.theme.moreCount', '{count} more', { count: themeList.length - maxVisible }),
        });

        moreItem.append(moreIcon, moreLabel);
        list.append(moreItem);
      }
    } catch (err) {
      loading.textContent = t('list.theme.error', 'Failed to load themes');
      // eslint-disable-next-line no-console
      console.error('[theme-picker] Failed to load themes:', err);
    }
  }

  return {
    el,
    load,

    /**
     * Get loaded themes.
     */
    getThemes() {
      return themes;
    },

    /**
     * Cleanup resize observers.
     */
    detach() {
      for (const fn of detachCallbacks) {
        try {
          fn?.();
        } catch {
          // ignore
        }
      }
      detachCallbacks.length = 0;
    },
  };
}