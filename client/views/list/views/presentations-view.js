import { t } from '../../../lib/ui-i18n.js';
import { createTagFilter, filterPresentationsByTags } from '../tag-filter.js';
import { createNoPresentationsEmptyState } from '../../../lib/dom/empty-state.js';
import { storage } from '../../../lib/storage.js';
import { h } from '../../../lib/dom.js';

/**
 * Unified "Presentations" view — one filterable surface that replaces the
 * separate Recent / Workspace / My presentations / Shared with me tabs.
 *
 * Ownership chips (All · Mine · Workspace · Shared) pick the source; a tag
 * filter and a sort control refine it. Everything the user can see arrives in
 * one `allByDate` array, so each chip is just a predicate over that list — no
 * extra fetches, no per-view state to keep in sync.
 *
 * @param {object} opts
 * @param {Function} opts.api - API client function
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Array} opts.allByDate - All visible presentations, newest first
 * @param {Function} [opts.onCreate] - Open the creation view (for the empty state)
 * @returns {object} - { el, list, tagFilter, refresh, addPresentation }
 */
export function createPresentationsView({
  api,
  renderCard,
  allByDate,
  onCreate,
}) {
  const OWNERSHIP_KEY = 'ps:presentations-ownership';
  const SORT_KEY = 'ps:presentations-sort';
  const OWNERSHIPS = ['all', 'mine', 'organization', 'shared'];
  const SORTS = ['recent', 'title'];

  let all = [...allByDate];
  let selectedTags = [];
  let ownership = OWNERSHIPS.includes(storage.get(OWNERSHIP_KEY, ''))
    ? storage.get(OWNERSHIP_KEY, '')
    : 'all';
  let sort = SORTS.includes(storage.get(SORT_KEY, ''))
    ? storage.get(SORT_KEY, '')
    : 'recent';

  const view = h('div', {
    class: 'sidebar-view',
    'data-view': 'presentations',
  });
  const title = h('h2', {
    class: 'presentation-grid-title',
    text: t('list.presentations.title', 'Presentations'),
  });
  const list = h('div', { class: 'list presentation-grid' });

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
    ownershipButtons.set(key, btn);
    ownershipFilter.append(btn);
  }

  // Sort control.
  const sortSelect = h(
    'select',
    {
      class: 'form-input sort-select',
      'aria-label': t('list.presentations.sortLabel', 'Sort presentations'),
      onchange: (e) => {
        sort = SORTS.includes(e.target.value) ? e.target.value : 'recent';
        storage.set(SORT_KEY, sort);
        renderList();
      },
    },
    [
      h('option', {
        value: 'recent',
        text: t('list.presentations.sort.recent', 'Last updated'),
      }),
      h('option', {
        value: 'title',
        text: t('list.presentations.sort.title', 'Title A–Z'),
      }),
    ],
  );
  sortSelect.value = sort;

  const tagFilter = createTagFilter({
    api,
    onFilterChange: (tags) => {
      selectedTags = tags;
      renderList();
    },
  });

  const header = h(
    'div',
    { class: 'view-header-with-filter is-presentations' },
    [
      title,
      h('div', { class: 'view-filters' }, [
        ownershipFilter,
        sortSelect,
        tagFilter.el,
      ]),
    ],
  );

  const ownershipLabel = (key) =>
    ({
      all: t('list.presentations.ownership.all', 'All'),
      mine: t('list.presentations.ownership.mine', 'Mine'),
      organization: t('list.presentations.ownership.organization', 'Workspace'),
      shared: t('list.presentations.ownership.shared', 'Shared'),
    })[key] || key;

  const inOwnership = (p, key) => {
    switch (key) {
      case 'mine':
        return !p.isSharedWithMe;
      case 'organization':
        return p.visibility === 'organization';
      case 'shared':
        return !!p.isSharedWithMe;
      default:
        return true;
    }
  };

  const cardOpts = (p) => ({
    isOrganization: p.visibility === 'organization',
    isSharedWithMe: p.isSharedWithMe,
    sharedBy: p.sharedBy,
    permission: p.permission,
  });

  const sortList = (arr) => {
    if (sort === 'title') {
      return [...arr].sort((a, b) =>
        String(a.title || '').localeCompare(String(b.title || ''), undefined, {
          sensitivity: 'base',
        }),
      );
    }
    return arr; // `all` is already newest-first
  };

  function setOwnership(key) {
    if (!OWNERSHIPS.includes(key) || key === ownership) return;
    ownership = key;
    storage.set(OWNERSHIP_KEY, ownership);
    renderList();
  }

  function renderList() {
    // Chip counts reflect the current tag filter, so "Workspace 3" means three
    // workspace decks match what's actually shown.
    const tagFiltered = filterPresentationsByTags(all, selectedTags);
    for (const key of OWNERSHIPS) {
      const count = tagFiltered.filter((p) => inOwnership(p, key)).length;
      const btn = ownershipButtons.get(key);
      btn.innerHTML = '';
      btn.append(
        h('span', {
          class: 'ownership-filter-label',
          text: ownershipLabel(key),
        }),
        h('span', { class: 'ownership-filter-count', text: String(count) }),
      );
      btn.classList.toggle('is-active', key === ownership);
      btn.setAttribute('aria-selected', String(key === ownership));
    }

    const filtered = sortList(
      tagFiltered.filter((p) => inOwnership(p, ownership)),
    );

    list.innerHTML = '';
    if (filtered.length === 0) {
      if (selectedTags.length > 0 || ownership !== 'all') {
        list.append(
          h('div', {
            class: 'help',
            text: t(
              'list.presentations.noMatch',
              'No presentations match the selected filters.',
            ),
          }),
        );
      } else if (typeof onCreate === 'function') {
        list.append(createNoPresentationsEmptyState({ onCreate }));
      } else {
        list.append(
          h('div', {
            class: 'help',
            text: t('list.presentations.empty', 'No presentations yet.'),
          }),
        );
      }
      return;
    }
    for (const p of filtered) {
      list.append(renderCard(p, cardOpts(p)));
    }
  }

  view.append(header, list);
  renderList();

  return {
    el: view,
    list,
    tagFilter,
    refresh: () => {
      tagFilter.refresh();
      renderList();
    },
    /**
     * Insert a freshly created/duplicated deck at the top and re-render so
     * counts and filters stay correct.
     * @param {object} p - list item
     */
    addPresentation: (p) => {
      if (!p?.id) return;
      all = [p, ...all.filter((x) => x.id !== p.id)];
      renderList();
    },
  };
}
