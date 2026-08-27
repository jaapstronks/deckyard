import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom.js';
import { createSlideLibraryPicker } from '../../../lib/slide-library/index.js';
import { createDeckFromLibraryItems } from '../../../lib/slide-library/compose.js';
import { createCollectionsBar } from '../../../lib/slide-collections/collections-bar.js';
import { toast } from '../../../lib/dom/toast.js';
import { getFeatures } from '../../../lib/state/features.js';
import { createSandboxLibraryExplainer } from './sandbox-library-explainer.js';
import { nav } from '../../../lib/state/router.js';

/**
 * Create the slide library view (lazy-loaded)
 *
 * @param {object} opts
 * @param {Function} opts.api - API client
 * @returns {object} - { el, load, refresh, openSlide }
 */
export function createSlideLibraryView({ api }) {
  const view = h('div', { class: 'sidebar-view', 'data-view': 'slideLibrary' });
  const title = h('h2', {
    class: 'presentation-grid-title',
    text: t('slideLibrary.modal.title', 'Slide library'),
  });
  const hint = h('p', {
    class: 'help',
    text: t(
      'slideLibrary.modal.browseHelp',
      'Browse your slide library. Copy a slide to paste later, or start a new presentation with it.',
    ),
  });
  const mount = h('div', { class: 'ps-slide-library-view-mount' });
  const loading = h('div', {
    class: 'help',
    text: t('common.loading', 'Loading…'),
  });

  let loaded = false;
  let picker = null;
  let collectionsBar = null;

  view.append(title, hint, loading);

  /**
   * Copy slide data to clipboard (uses content for the selected language)
   */
  async function copySlide(item) {
    try {
      const slideData = {
        type: item.slideType,
        content: item.content || {},
        _fromLibrary: true,
      };
      await navigator.clipboard.writeText(JSON.stringify(slideData));
      toast.success(
        t(
          'slideLibrary.copy.done',
          'Slide copied! Paste it in a presentation with Ctrl/Cmd+V.',
        ),
      );
    } catch (e) {
      toast.error(
        t('slideLibrary.copy.failed', 'Failed to copy slide to clipboard.'),
      );
    }
  }

  /**
   * Create a new presentation with slide(s) (uses content and language from selection)
   * @param {Object|Object[]} itemOrItems - Single item or array of items
   */
  async function createNewPresentation(itemOrItems) {
    try {
      // Handle both single item and array of items
      const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
      if (items.length === 0) return;

      // Dominant language: the picker's active language (single-slide "Use"
      // path forwards it via _selectedLang), else fall back to the picker state.
      const selectedLang =
        items[0]?._selectedLang || picker?.getActiveLang?.() || 'nl';
      // Use the theme of the first item; with none known the server picks
      // the default (sandbox-aware), so no client-side fallback here.
      const theme = items[0]?.themeId || null;

      // The shared helper forwards per-language content so the deck keeps NL + EN.
      const result = await createDeckFromLibraryItems({
        api,
        items,
        title: t(
          'slideLibrary.newPresentation.defaultTitle',
          'New Presentation',
        ),
        theme,
        lang: selectedLang,
      });

      const msg =
        items.length === 1
          ? t('slideLibrary.newPresentation.done', 'Presentation created!')
          : t(
              'slideLibrary.newPresentation.doneMultiple',
              'Presentation created with {count} slides!',
              { count: String(items.length) },
            );
      toast.success(msg);

      if (result?.id) {
        nav(`/app/${result.id}`);
      }
    } catch (e) {
      toast.error(
        t(
          'slideLibrary.newPresentation.failed',
          'Failed to create presentation.',
        ),
      );
    }
  }

  async function load() {
    if (loaded) return;

    // Sandbox: no team, no reusable slides — show an explainer/mockup of what
    // the library is for in a real Deckyard instead of an empty grid.
    if (getFeatures()?.sandboxMode) {
      loaded = true;
      view.innerHTML = '';
      view.append(createSandboxLibraryExplainer());
      return;
    }

    try {
      loaded = true;
      view.innerHTML = '';

      // Collections management sits above the grid; membership add hangs off the
      // per-card more-menu via onAddToCollection.
      collectionsBar = createCollectionsBar({ api, root: document.body });
      view.append(title, hint, collectionsBar.el, mount);
      collectionsBar.refresh();

      // Create the slide library picker in browse-only mode with language switching
      picker = createSlideLibraryPicker({
        api,
        allowInsert: false, // Browse-only mode
        showLanguageSwitch: true, // Enable language switching in browse mode
        initialLang: 'nl', // Default to Dutch
        onCopySlide: copySlide,
        onNewPresentation: createNewPresentation,
        onAddToCollection: (item, shelf) =>
          collectionsBar?.openAddTo({ ...item, _shelf: shelf }),
        // Permalink support: update URL when slide opens/closes
        onSlideOpen: ({ shelf, slideId }) => {
          const url = `/app/slide-library/${shelf}/${slideId}`;
          history.pushState(null, '', url);
        },
        onSlideClose: () => {
          // Return to the base slide library URL
          history.pushState(null, '', '/app');
        },
      });

      await picker.renderSlideLibraryPicker(mount);
    } catch (e) {
      view.innerHTML = '';
      view.append(
        title,
        hint,
        h('div', {
          class: 'help is-error',
          text: t('slideLibrary.loadError', 'Failed to load slide library.'),
        }),
      );
    }
  }

  /**
   * Open a specific slide by ID (for permalink navigation)
   * @param {string} shelf - 'organization' or 'personal'
   * @param {string} slideId - The slide ID to open
   */
  async function openSlide(shelf, slideId) {
    await load();
    if (picker?.openSlideById) {
      await picker.openSlideById(shelf, slideId);
    }
  }

  function refresh() {
    loaded = false;
    mount.innerHTML = '';
    load();
  }

  return {
    el: view,
    load,
    refresh,
    openSlide,
  };
}
