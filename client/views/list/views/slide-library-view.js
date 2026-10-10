import { t, getUiLocale } from '../../../lib/ui-i18n.js';
import {
  readStoredLangMode,
  resolveInitialDeckLang,
} from '../../../lib/format/i18n.js';
import { h } from '../../../lib/dom/index.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import {
  createSlideLibraryPicker,
  copyLibraryItemToClipboard,
  createDeckFromLibraryItems,
  deckLangForLibraryItems,
} from '../../slide-library/index.js';
import { createCollectionsBar } from '../collections/index.js';
import { toast } from '../../../lib/dom/toast.js';
import {
  nav,
  pushPath,
  replacePath,
  route,
  slideLibraryPath,
} from '../../../lib/state/router.js';
import { DEFAULT_DECK_LANG } from '../../../../shared/i18n-utils.js';

/**
 * Create the slide library view (lazy-loaded)
 *
 * The view owns its address: `/app/slide-library`, and
 * `/app/slide-library/<shelf>/<slideId>` while a slide is open (B285).
 *
 * @param {object} opts
 * @param {Function} opts.api - API client
 * @param {'organization'|'personal'} [opts.initialShelf] - The shelf to open
 *   on; a permalink names it, so the first render already loads that shelf
 * @returns {object} - { el, load, refresh, openSlide }
 */
export function createSlideLibraryView({ api, initialShelf = 'organization' }) {
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

  // A permalink to a slide that is not there: a state of the view, said in
  // place of the slide (inline-error doctrine, not a toast).
  const notFound = createInlineError({ live: 'polite' });
  let rendered = null;
  let picker = null;
  let collectionsBar = null;

  view.append(title, hint, loading);

  /**
   * Copy a slide onto the slide clipboard (content for the selected language),
   * where the editor's paste bar and Ctrl/Cmd+V pick it up.
   */
  function copySlide(item) {
    if (copyLibraryItemToClipboard(item)) {
      toast.success(
        t(
          'slideLibrary.copy.done',
          'Slide copied! Paste it in a presentation with Ctrl/Cmd+V.',
        ),
      );
    } else {
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
      // path forwards it via _selectedLang), else the picker state, unless the
      // slides are not written in it: then the language they share (B603).
      const selectedLang = deckLangForLibraryItems(
        items,
        items[0]?._selectedLang ||
          picker?.getActiveLang?.() ||
          DEFAULT_DECK_LANG,
      );
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

      if (result?.id) {
        nav(`/app/${result.id}`);
      }
    } catch (e) {
      // The server's sentence (a size limit, a refused type), not generic copy.
      toast.error(e);
    }
  }

  /**
   * Render the library once. Every caller gets the same promise, so whoever
   * comes second (the permalink, after the tab switch started the render)
   * waits for the list instead of finding it half built.
   * @returns {Promise<void>}
   */
  function load() {
    rendered ??= render();
    return rendered;
  }

  async function render() {
    try {
      view.innerHTML = '';

      // Collections management sits above the grid; membership add hangs off the
      // per-card more-menu via onAddToCollection.
      collectionsBar = createCollectionsBar({ api, root: document.body });
      view.append(title, hint, notFound.el, collectionsBar.el, mount);
      collectionsBar.refresh();

      // Create the slide library picker in browse-only mode with language switching
      picker = createSlideLibraryPicker({
        api,
        allowInsert: false, // Browse-only mode
        showLanguageSwitch: true, // Enable language switching in browse mode
        // The language a new deck would start in (stored choice, else the UI
        // locale): an English reader is not shown an empty Dutch shelf (B603).
        initialShelf,
        initialLang: resolveInitialDeckLang({
          storedLang: readStoredLangMode(),
          uiLocale: getUiLocale(),
        }),
        onCopySlide: copySlide,
        onNewPresentation: createNewPresentation,
        onAddToCollection: (item, shelf) =>
          collectionsBar?.openAddTo({ ...item, _shelf: shelf }),
        // An opened slide is a history entry: back closes it. A permalink
        // that opened it is already that address, so nothing is pushed.
        onSlideOpen: ({ shelf, slideId }) =>
          pushPath(slideLibraryPath(shelf, slideId)),
        // Closing returns to the library in place. Only while the address
        // is still this slide's: a view teardown closes the modal too, after
        // the router has already moved on to another page.
        onSlideClose: () => {
          if (route().slideId) replacePath(slideLibraryPath());
        },
      });

      await picker.renderSlideLibraryPicker(mount);
    } catch {
      // The view could not load: a state of the view, announced politely.
      const loadError = createInlineError({ live: 'polite' });
      view.innerHTML = '';
      view.append(title, hint, loadError.el);
      loadError.show(
        t('slideLibrary.loadError', 'Failed to load slide library.'),
        { focus: false },
      );
    }
  }

  /**
   * Open a specific slide by ID (for permalink navigation). A slide that is
   * gone, or that the viewer may not see, leaves the library open with a
   * notice and the library's own address.
   * @param {string} shelf - 'organization' or 'personal'
   * @param {string} slideId - The slide ID to open
   */
  async function openSlide(shelf, slideId) {
    await load();
    if (!picker) return;
    notFound.clear();
    if (await picker.openSlideById(shelf, slideId)) return;
    replacePath(slideLibraryPath());
    notFound.show(
      t(
        'slideLibrary.permalink.notFound',
        'This slide is not in the library, or you do not have access to it.',
      ),
      { focus: false },
    );
  }

  function refresh() {
    rendered = null;
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
