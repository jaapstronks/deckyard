/**
 * Library-compose concern for the creation view.
 *
 * The "From the library" method is a self-contained sub-feature: pick reusable
 * slides (from all slides, or seeded from a saved Collection), reorder them in a
 * tray, and compose a new deck. All of its state — the source toggle, the
 * picker, the ordered selection, the collections cache — lives here, exclusive
 * to this concern; the creation view only wires it in.
 *
 * Split out of creation-view/index.js (B10 P4 seam), behaviour-preserving.
 *
 * The host provides three callbacks:
 *   - onSelectionChange() — re-run the host's syncUI (the Create button label
 *     and disabled state read the live selection count).
 *   - setStatus(text)     — write the shared footer status line.
 *   - isBusy()            — read the host's busy flag (guards source switches).
 */

import { t } from '../../../../lib/ui-i18n.js';
import { createSlideLibraryPicker } from '../../../../lib/slide-library/index.js';
import { createDeckFromLibraryItems } from '../../../../lib/slide-library/compose.js';
import { createCollectionsApi } from '../../../../lib/slide-collections/api.js';
import { h } from '../../../../lib/dom.js';
import { createInlineError } from '../../../../lib/dom/inline-error.js';
import { nav } from '../../../../lib/state/router.js';

/**
 * @param {object} opts
 * @param {Function} opts.api - fetch wrapper.
 * @param {() => void} opts.onSelectionChange - re-run host syncUI.
 * @param {(text: string) => void} opts.setStatus - write footer status.
 * @param {() => boolean} opts.isBusy - read host busy flag.
 * @returns {object} library-compose controller
 */
export function createLibraryCompose({
  api,
  onSelectionChange,
  setStatus,
  isBusy,
}) {
  const syncUI = () => onSelectionChange?.();

  // ===== Panel DOM =====
  const panel = h('div', {
    class: 'creation-panel is-hidden',
    'data-method': 'library',
  });

  // Source toggle: start from a saved Collection, or pick from all slides.
  let libraryMode = 'all'; // 'all' | 'collections'
  const sourceTabs = h('div', {
    class: 'sb-segmented creation-library-source',
  });
  const btnSourceCollections = h('button', {
    type: 'button',
    class: 'sb-segmented-btn',
    text: t('list.creationView.library.source.collections', 'Collections'),
  });
  const btnSourceAll = h('button', {
    type: 'button',
    class: 'sb-segmented-btn is-active',
    text: t('list.creationView.library.source.all', 'All slides'),
  });
  sourceTabs.append(btnSourceCollections, btnSourceAll);

  const hint = h('div', {
    class: 'help modal-hint',
    text: t(
      'list.creationView.library.help',
      'Pick reusable slides to compose a new deck. Check slides to add them, then drag to reorder.',
    ),
  });
  const pickerMount = h('div', { class: 'creation-library-picker' });
  const collectionsMount = h('div', {
    class: 'creation-library-collections is-hidden',
  });
  const trayWrap = h('div', { class: 'creation-library-tray is-hidden' });
  panel.append(sourceTabs, hint, pickerMount, collectionsMount, trayWrap);

  // Selected library slides, in the order they will appear in the new deck.
  // The picker owns selection; the panel keeps an ordered id list so drag
  // reorder is stable across selection toggles.
  let picker = null;
  let pickerLoaded = false;
  let selectedOrder = []; // slide-library item ids, in deck order
  let selectedById = new Map(); // id -> library item

  const orderedSelectedItems = () =>
    selectedOrder.map((id) => selectedById.get(id)).filter(Boolean);

  const renderTray = () => {
    const items = orderedSelectedItems();
    trayWrap.classList.toggle('is-hidden', items.length === 0);
    trayWrap.innerHTML = '';
    if (!items.length) return;

    trayWrap.append(
      h('div', {
        class: 'field-label',
        text: t(
          'list.creationView.library.selected',
          'Selected slides ({count})',
          {
            count: String(items.length),
          },
        ),
      }),
    );

    const list = h('div', { class: 'creation-tray-list' });
    items.forEach((item, index) => {
      const chip = h('div', {
        class: 'creation-tray-chip',
        draggable: 'true',
        'data-id': item.id,
      });
      chip.append(
        h('span', { class: 'creation-tray-order', text: String(index + 1) }),
        h('span', {
          class: 'creation-tray-name',
          text:
            item.name ||
            item.slideType ||
            t('slideLibrary.preview.untitled', 'Untitled'),
        }),
        h('button', {
          type: 'button',
          class: 'creation-tray-remove',
          'aria-label': t('common.remove', 'Remove'),
          text: '×',
          onclick: () => deselectFromTray(item.id),
        }),
      );

      // Drag to reorder within the tray.
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'move';
        chip.classList.add('is-dragging');
      });
      chip.addEventListener('dragend', () =>
        chip.classList.remove('is-dragging'),
      );
      chip.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      chip.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === item.id) return;
        const from = selectedOrder.indexOf(draggedId);
        const to = selectedOrder.indexOf(item.id);
        if (from < 0 || to < 0) return;
        selectedOrder.splice(from, 1);
        selectedOrder.splice(to, 0, draggedId);
        renderTray();
      });

      list.append(chip);
    });
    trayWrap.append(list);
  };

  // Remove a slide from the tray. In "all slides" mode the picker owns
  // membership, so tell it to deselect (onSelectionChange reconciles). In
  // "collections" mode the tray is the source of truth, so edit it directly.
  const deselectFromTray = (id) => {
    if (libraryMode === 'collections') {
      selectedOrder = selectedOrder.filter((x) => x !== id);
      selectedById.delete(id);
      renderTray();
      syncUI();
      return;
    }
    picker?.deselectItem?.(id, pickerMount);
  };

  // Reconcile the ordered tray against the picker's current selection:
  // keep existing order for still-selected items, append newly-checked ones,
  // drop unchecked ones.
  const reconcileSelection = (items) => {
    const nextIds = items.map((it) => it.id);
    const nextSet = new Set(nextIds);
    selectedById = new Map(items.map((it) => [it.id, it]));
    selectedOrder = selectedOrder.filter((id) => nextSet.has(id));
    for (const id of nextIds) {
      if (!selectedOrder.includes(id)) selectedOrder.push(id);
    }
    renderTray();
    syncUI();
  };

  // Lazily mount the library picker the first time the method is selected.
  const ensurePicker = async () => {
    if (pickerLoaded) return;
    pickerLoaded = true;
    picker = createSlideLibraryPicker({
      api,
      allowInsert: false,
      compose: true,
      initialShelf: 'organization',
      onSelectionChange: (items) => reconcileSelection(items),
    });
    try {
      await picker.renderSlideLibraryPicker(pickerMount);
    } catch {
      // A source that did not load is a state of the panel, not a refusal of
      // something the user just submitted: polite, in place, focus untouched.
      const loadError = createInlineError({ live: 'polite' });
      pickerMount.innerHTML = '';
      pickerMount.append(loadError.el);
      loadError.show(
        t('slideLibrary.loadError', 'Failed to load slide library.'),
        { focus: false },
      );
    }
  };

  // ===== Collections source =====
  const collectionsApi = createCollectionsApi({ api });
  let collectionsLoaded = false;
  let slideIndexCache = null; // id -> library item (skips trashed)
  // The collection the current compose started from, if any. Forwarded to the
  // server so it records collection usage (clears the Home "new to you" badge).
  let activeCollectionId = null;

  // Resolve library items once so a collection's ids can become real slides.
  const ensureSlideIndex = async () => {
    if (slideIndexCache) return slideIndexCache;
    const index = new Map();
    for (const shelf of ['personal', 'organization']) {
      try {
        const r = await api(`/api/slide-library/${shelf}`);
        for (const it of Array.isArray(r?.items) ? r.items : []) {
          const trashed = !!(it?.isTrashed || it?.trashedAt);
          if (it?.id && !trashed && !index.has(it.id)) index.set(it.id, it);
        }
      } catch {
        // ignore; unresolved members are skipped when seeding
      }
    }
    slideIndexCache = index;
    return index;
  };

  // Pre-seed the compose tray with a collection's slides, in its stored order.
  const seedCollection = async (collection) => {
    const index = await ensureSlideIndex();
    const ids = Array.isArray(collection?.slideIds) ? collection.slideIds : [];
    const resolved = ids.map((id) => index.get(id)).filter(Boolean);
    activeCollectionId = collection?.id || null;
    selectedById = new Map(resolved.map((it) => [it.id, it]));
    selectedOrder = resolved.map((it) => it.id);
    // Reflect the active collection in the chooser.
    for (const btn of collectionsMount.querySelectorAll(
      '.creation-collection-card',
    )) {
      btn.classList.toggle(
        'is-active',
        btn.getAttribute('data-id') === collection.id,
      );
    }
    renderTray();
    syncUI();
    if (!resolved.length) {
      setStatus(
        t(
          'list.creationView.library.collectionEmpty',
          'This collection has no available slides.',
        ),
      );
    } else {
      setStatus('');
    }
  };

  const renderCollectionsChooser = (collections) => {
    collectionsMount.innerHTML = '';
    const all = [
      ...(collections?.personal || []),
      ...(collections?.organization || []),
    ];
    if (!all.length) {
      collectionsMount.append(
        h('div', {
          class: 'help',
          text: t(
            'list.creationView.library.noCollections',
            'No collections yet. Create one from the slide library to start decks from it.',
          ),
        }),
      );
      return;
    }
    const grid = h('div', { class: 'creation-collection-grid' });
    for (const col of all) {
      const card = h('button', {
        type: 'button',
        class: 'creation-collection-card',
        'data-id': col.id,
        onclick: () => seedCollection(col),
      });
      card.append(
        h('span', {
          class: 'creation-collection-card-name',
          text: col.name || t('slideLibrary.preview.untitled', 'Untitled'),
        }),
      );
      const meta = h('span', { class: 'creation-collection-card-meta' });
      if (col.shelf === 'organization') {
        meta.append(
          h('span', {
            class: 'creation-collection-card-badge',
            text: t('slideLibrary.shelf.organization', 'Team'),
          }),
        );
      }
      meta.append(
        h('span', {
          class: 'creation-collection-card-count',
          text: t(
            'list.creationView.library.collectionCount',
            '{count} slides',
            {
              count: String(
                col.slideCount ??
                  (Array.isArray(col.slideIds) ? col.slideIds.length : 0),
              ),
            },
          ),
        }),
      );
      card.append(meta);
      grid.append(card);
    }
    collectionsMount.append(grid);
  };

  const ensureCollectionsChooser = async () => {
    if (collectionsLoaded) return;
    collectionsLoaded = true;
    collectionsMount.innerHTML = '';
    collectionsMount.append(
      h('div', { class: 'help', text: t('common.loading', 'Loading…') }),
    );
    try {
      const collections = await collectionsApi.listAll();
      renderCollectionsChooser(collections);
    } catch {
      const loadError = createInlineError({ live: 'polite' });
      collectionsMount.innerHTML = '';
      collectionsMount.append(loadError.el);
      loadError.show(
        t(
          'list.creationView.library.collectionsError',
          'Failed to load collections.',
        ),
        { focus: false },
      );
    }
  };

  // Switch the library source. Changing source clears the current selection so
  // the tray always reflects exactly one source.
  const switchMode = (mode) => {
    if (isBusy() || mode === libraryMode) return;
    libraryMode = mode;
    // Clear selection on both sides.
    picker?.clearSelection?.(pickerMount);
    activeCollectionId = null;
    selectedOrder = [];
    selectedById = new Map();
    renderTray();
    setStatus('');
    if (mode === 'collections') ensureCollectionsChooser();
    else ensurePicker();
    syncUI();
  };

  btnSourceCollections.addEventListener('click', () =>
    switchMode('collections'),
  );
  btnSourceAll.addEventListener('click', () => switchMode('all'));

  // Update the panel's own controls to match the current source. Called from
  // the host's syncUI (the source toggle and hint live inside this panel).
  const syncPanel = () => {
    btnSourceCollections.classList.toggle(
      'is-active',
      libraryMode === 'collections',
    );
    btnSourceAll.classList.toggle('is-active', libraryMode === 'all');
    pickerMount.classList.toggle('is-hidden', libraryMode !== 'all');
    collectionsMount.classList.toggle(
      'is-hidden',
      libraryMode !== 'collections',
    );
    hint.textContent =
      libraryMode === 'collections'
        ? t(
            'list.creationView.library.collectionsHelp',
            'Pick a collection to pre-fill the deck. Reorder or remove slides below, then create.',
          )
        : t(
            'list.creationView.library.help',
            'Pick reusable slides to compose a new deck. Check slides to add them, then drag to reorder.',
          );
  };

  // Compose a new deck from the selected library slides (batch primitive,
  // preserving both languages via the shared compose helper).
  //
  // @param {object} ctx
  // @param {string} ctx.lang - deck language (a `TRANSLATION_LANGS` code).
  // @param {string} ctx.theme - theme id.
  // @param {Function} ctx.nav - router navigate.
  // @param {Function} ctx.close - close the creation view.
  // @param {(v: boolean) => void} ctx.setBusy - toggle host busy state.
  const compose = async ({ lang, theme, close, setBusy }) => {
    const items = orderedSelectedItems();
    if (!items.length) {
      setStatus(
        t(
          'list.creationView.library.selectFirst',
          'Select at least one slide.',
        ),
      );
      return;
    }
    setBusy(true);
    setStatus(t('list.newPresentation.creating', 'Creating…'));
    try {
      const created = await createDeckFromLibraryItems({
        api,
        items,
        title: t(
          'slideLibrary.newPresentation.defaultTitle',
          'New Presentation',
        ),
        theme,
        lang,
        sourceCollectionId:
          libraryMode === 'collections' ? activeCollectionId : null,
      });
      close();
      nav(`/app/${created.id}?lang=${encodeURIComponent(lang)}`);
    } catch (e) {
      setStatus(String(e?.message || e));
      setBusy(false);
    }
  };

  // Seed the tray directly from an already-resolved list of library items
  // (Home "Building blocks" shelf). The collections source owns the tray, so
  // the caller switches to that mode first.
  const seedItems = (items) => {
    selectedById = new Map(items.map((it) => [it.id, it]));
    selectedOrder = items.map((it) => it.id);
    renderTray();
    syncUI();
  };

  return {
    /** The library method's panel element (append into the right pane). */
    panel,
    /** Lazily mount the slide-library picker (all-slides source). */
    ensurePicker,
    /** Lazily load and render the collections chooser. */
    ensureCollectionsChooser,
    /** Seed the tray from a saved collection (async). */
    seedCollection,
    /** Seed the tray from a resolved item list. */
    seedItems,
    /** Force the active source ('all' | 'collections') without switch side effects. */
    setMode: (mode) => {
      libraryMode = mode;
    },
    /** Current source mode. */
    getMode: () => libraryMode,
    /** Update the panel's own source toggle + hint (call from host syncUI). */
    syncPanel,
    /** Number of slides currently selected. */
    getSelectedCount: () => selectedOrder.length,
    /** Whether the user has selected any slides. */
    isDirty: () => selectedOrder.length > 0,
    /** Compose the deck from the current selection. */
    compose,
  };
}
