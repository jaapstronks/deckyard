import { t } from '../../../lib/ui-i18n.js';
import { createTagFilter } from '../tag-filter.js';
import { createDeckPager } from '../deck-pager.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { createNoPresentationsEmptyState } from '../../../lib/dom/empty-state.js';
import { storage } from '../../../lib/storage.js';
import { h } from '../../../lib/dom/index.js';

/**
 * The ownership chips and the list filter each one asks the server for. The
 * chips are filters on the server's deck list, not predicates over loaded
 * cards: the list is paged (D358, B821), so a client-side filter, count or
 * sort would only describe the pages loaded so far.
 */
const OWNERSHIP_FILTERS = Object.freeze({
  all: { ownership: 'all' },
  mine: { ownership: 'owned' },
  organization: { ownership: 'all', visibility: 'organization' },
  shared: { ownership: 'shared' },
});

/**
 * Unified "Presentations" view — one filterable surface that replaces the
 * separate Recent / Workspace / My presentations / Shared with me tabs.
 *
 * Ownership chips (All · Mine · Organization · Shared) pick the source and a tag
 * filter narrows it; both go to the server, which answers the decks newest
 * change first, one page at a time, with "Load more" below the grid.
 *
 * @param {object} opts
 * @param {Function} opts.api - API client function
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Function} [opts.onCreate] - Open the creation view (for the empty state)
 * @returns {object} - { el, list, tagFilter, load, refresh, addPresentation }
 */
export function createPresentationsView({ api, renderCard, onCreate }) {
  const OWNERSHIP_KEY = 'ps:presentations-ownership';
  const OWNERSHIPS = Object.keys(OWNERSHIP_FILTERS);

  let selectedTags = [];
  let ownership = OWNERSHIPS.includes(storage.get(OWNERSHIP_KEY, ''))
    ? storage.get(OWNERSHIP_KEY, '')
    : 'all';
  let loaded = false;

  const view = h('div', {
    class: 'sidebar-view',
    'data-view': 'presentations',
  });
  const title = h('h2', {
    class: 'presentation-grid-title',
    text: t('list.presentations.title', 'Presentations'),
  });
  const list = h('div', { class: 'list presentation-grid' });
  const status = h('div', { class: 'presentation-grid-status' });

  // Ownership chips — the primary source filter (and the replacement for the
  // old Recent/Workspace/Shared tabs), so they stay visible on every viewport.
  const ownershipFilter = h('div', {
    class: 'ownership-filter',
    role: 'tablist',
    'aria-label': t(
      'list.presentations.ownershipLabel',
      'Filter presentations by source',
    ),
  });
  const ownershipButtons = new Map();
  for (const key of OWNERSHIPS) {
    const btn = h('button', {
      class: 'ownership-filter-btn',
      type: 'button',
      role: 'tab',
      'data-ownership': key,
      'aria-selected': String(key === ownership),
      onclick: () => setOwnership(key),
    });
    btn.append(
      h('span', {
        class: 'ownership-filter-label',
        text: ownershipLabel(key),
      }),
    );
    ownershipButtons.set(key, btn);
    ownershipFilter.append(btn);
  }

  const tagFilter = createTagFilter({
    api,
    onFilterChange: (tags) => {
      selectedTags = tags;
      reload();
    },
  });

  const header = h(
    'div',
    { class: 'view-header-with-filter is-presentations' },
    [
      title,
      h('div', { class: 'view-filters' }, [ownershipFilter, tagFilter.el]),
    ],
  );

  function ownershipLabel(key) {
    return (
      {
        all: t('list.presentations.ownership.all', 'All'),
        mine: t('list.presentations.ownership.mine', 'Mine'),
        organization: t(
          'list.presentations.ownership.organization',
          'Organization',
        ),
        shared: t('list.presentations.ownership.shared', 'Shared'),
      }[key] || key
    );
  }

  const cardOpts = (p) => ({
    isOrganization: p.visibility === 'organization',
    isSharedWithMe: p.isSharedWithMe,
    sharedBy: p.sharedBy,
    permission: p.permission,
  });

  const pager = createDeckPager({
    api,
    path: '/api/presentations',
    onPage: (decks, { first }) => {
      if (first) {
        list.replaceChildren();
        status.replaceChildren();
        if (decks.length === 0) status.append(emptyState());
      }
      for (const p of decks) list.append(renderCard(p, cardOpts(p)));
    },
  });

  function emptyState() {
    if (selectedTags.length > 0 || ownership !== 'all') {
      return h('div', {
        class: 'empty-note',
        text: t(
          'list.presentations.noMatch',
          'No presentations match the selected filters.',
        ),
      });
    }
    if (typeof onCreate === 'function') {
      return createNoPresentationsEmptyState({ onCreate });
    }
    return h('div', {
      class: 'empty-note',
      text: t('list.presentations.empty', 'No presentations yet.'),
    });
  }

  function syncChips() {
    for (const [key, btn] of ownershipButtons) {
      btn.classList.toggle('is-active', key === ownership);
      btn.setAttribute('aria-selected', String(key === ownership));
    }
  }

  function setOwnership(key) {
    if (!OWNERSHIPS.includes(key) || key === ownership) return;
    ownership = key;
    storage.set(OWNERSHIP_KEY, ownership);
    reload();
  }

  /** Read the first page under the current chip and tags. */
  async function reload() {
    loaded = true;
    syncChips();
    try {
      await pager.load({
        ...OWNERSHIP_FILTERS[ownership],
        tags: selectedTags,
      });
    } catch {
      list.replaceChildren();
      status.replaceChildren();
      const loadError = createInlineError({ live: 'polite' });
      status.append(loadError.el);
      loadError.show(
        t('list.presentations.loadError', 'Failed to load presentations.'),
        { focus: false },
      );
    }
  }

  view.append(header, list, status, pager.el);
  syncChips();

  return {
    el: view,
    list,
    tagFilter,
    /** Load the first page when the view is first shown. */
    load: () => (loaded ? Promise.resolve() : reload()),
    refresh: () => {
      tagFilter.refresh();
      return reload();
    },
    /**
     * A deck was just created or duplicated: read the list again, so it shows
     * at the top under the filters that keep it.
     */
    addPresentation: () => reload(),
  };
}
