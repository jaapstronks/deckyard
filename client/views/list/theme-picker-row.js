/**
 * Theme quick-picker row component.
 * Home's "Start something new": a row of theme cards (`theme-select`'s
 * `createThemeCard`, shared with the creation view) that open a new deck in
 * the chosen theme.
 */

import { t } from '../../lib/ui-i18n.js';
import { icon } from '../../lib/dom/icons.js';
import { h } from '../../lib/dom/index.js';
import { createInViewLoader } from '../../lib/dom/in-view.js';
import { createThemeCard } from '../theme-select/index.js';

/**
 * Create the theme quick-picker row component.
 * @param {Object} options
 * @param {Function} options.api - API function
 * @param {Function} options.onThemeSelect - Callback when theme is selected
 * @param {Function} options.onShowAll - Callback to show all themes
 * @param {number} options.maxVisible - Maximum themes to show (default: 5)
 * @returns {Object} { el, load, detach }
 */
export function createThemePickerRow({
  api,
  onThemeSelect,
  onShowAll,
  maxVisible = 5,
}) {
  const el = h('div', { class: 'theme-picker-row' });
  const inView = createInViewLoader();
  const cards = [];

  // Header — mirrors the shared `.presentation-section-header` treatment so
  // "Start something new" lines up with Recent / Popular / Activity.
  const header = h('div', { class: 'theme-picker-header' });
  const titleWrap = h('div', { class: 'theme-picker-title-group' }, [
    h('span', { class: 'presentation-section-icon', 'aria-hidden': 'true' }, [
      icon('sparkles', { size: 18 }),
    ]),
    h('span', {
      class: 'theme-picker-title',
      text: t('list.theme.startNew', 'Start something new'),
    }),
  ]);

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
    text: t('list.theme.loading', 'Loading themes…'),
  });

  el.append(header, loading);

  let themes = [];

  /**
   * Load and render themes.
   */
  async function load() {
    try {
      const [response, slideTypes] = await Promise.all([
        api('/api/themes'),
        api('/api/slide-types'),
      ]);
      const themeList = Array.isArray(response?.themes) ? response.themes : [];
      themes = themeList;

      // Clear loading, show list
      loading.remove();
      el.append(list);

      // One theme card per theme, the same card the creation view's grid
      // renders (D353); each loads and renders its slide when it scrolls in.
      for (const record of themeList.slice(0, maxVisible)) {
        const card = createThemeCard({
          record,
          slideTypes,
          inView,
          onSelect: () => onThemeSelect?.(record),
        });
        cards.push(card);
        list.append(card.el);
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
          text: t('list.theme.moreCount', '{count} more', {
            count: themeList.length - maxVisible,
          }),
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
     * Release the cards' observers.
     */
    detach() {
      inView.disconnect();
      for (const card of cards) card.detach();
      cards.length = 0;
    },
  };
}
