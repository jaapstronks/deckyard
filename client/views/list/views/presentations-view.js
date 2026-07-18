import { t } from '../../../lib/ui-i18n.js';
import { createTagFilter, filterPresentationsByTags } from '../tag-filter.js';
import { createNoPresentationsEmptyState } from '../empty-state.js';
import { storage } from '../../../lib/storage.js';

/**
 * Unified "Presentations" view — one filterable surface that replaces the
 * separate Recent / Workspace / My presentations / Shared with me tabs.
 *
 * Scope chips (All · Mine · Workspace · Shared) pick the source; a tag filter
 * and a sort control refine it. Everything the user can see arrives in one
 * `allByDate` array, so each chip is just a predicate over that list — no extra
 * fetches, no per-view state to keep in sync.
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client function
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Array} opts.allByDate - All visible presentations, newest first
 * @param {Function} [opts.onCreate] - Open the creation view (for the empty state)
 * @returns {object} - { el, list, tagFilter, refresh, addPresentation }
 */
export function createPresentationsView({ h, api, renderCard, allByDate, onCreate }) {
  const SCOPE_KEY = 'ps:presentations-scope';
  const SORT_KEY = 'ps:presentations-sort';
  const SCOPES = ['all', 'mine', 'workspace', 'shared'];
  const SORTS = ['recent', 'title'];

  let all = [...allByDate];
  let selectedTags = [];
  let scope = SCOPES.includes(storage.get(SCOPE_KEY, '')) ? storage.get(SCOPE_KEY, '') : 'all';
  let sort = SORTS.includes(storage.get(SORT_KEY, '')) ? storage.get(SORT_KEY, '') : 'recent';

  const view = h('div', { class: 'sidebar-view', 'data-view': 'presentations' });
  const title = h('h2', { class: 'presentation-grid-title', text: t('list.presentations.title', 'Presentations') });
  const list = h('div', { class: 'list presentation-grid' });

  // Scope chips — the primary source filter (and the replacement for the old
  // Recent/Workspace/Shared tabs), so they stay visible on every viewport.
  const scopeFilter = h('div', {
    class: 'scope-filter',
    role: 'tablist',
    'aria-label': t('list.presentations.scopeLabel', 'Filter presentations by source'),
  });
  const scopeButtons = new Map();
  for (const key of SCOPES) {
    const btn = h('button', {
      class: 'scope-filter-btn',
      type: 'button',
      role: 'tab',
      'data-scope': key,
      'aria-selected': String(key === scope),
      onclick: () => setScope(key),
    });
    scopeButtons.set(key, btn);
    scopeFilter.append(btn);
  }

  // Sort control.
  const sortSelect = h('select', {
    class: 'form-input sort-select',
    'aria-label': t('list.presentations.sortLabel', 'Sort presentations'),
    onchange: (e) => {
      sort = SORTS.includes(e.target.value) ? e.target.value : 'recent';
      storage.set(SORT_KEY, sort);
      renderList();
    },
  }, [
    h('option', { value: 'recent', text: t('list.presentations.sort.recent', 'Last updated') }),
    h('option', { value: 'title', text: t('list.presentations.sort.title', 'Title A–Z') }),
  ]);
  sortSelect.value = sort;

  const tagFilter = createTagFilter({
    api,
    onFilterChange: (tags) => {
      selectedTags = tags;
      renderList();
    },
  });

  const header = h('div', { class: 'view-header-with-filter is-presentations' }, [
    title,
    h('div', { class: 'view-filters' }, [scopeFilter, sortSelect, tagFilter.el]),
  ]);

  const scopeLabel = (key) => ({
    all: t('list.presentations.scope.all', 'All'),
    mine: t('list.presentations.scope.mine', 'Mine'),
    workspace: t('list.presentations.scope.workspace', 'Workspace'),
    shared: t('list.presentations.scope.shared', 'Shared'),
  }[key] || key);

  const inScope = (p, key) => {
    switch (key) {
      case 'mine':
        return !p.isSharedWithMe;
      case 'workspace':
        return p.scope === 'workspace';
      case 'shared':
        return !!p.isSharedWithMe;
      default:
        return true;
    }
  };

  const cardOpts = (p) => ({
    isWorkspace: p.scope === 'workspace',
    isSharedWithMe: p.isSharedWithMe,
    sharedBy: p.sharedBy,
    permission: p.permission,
  });

  const sortList = (arr) => {
    if (sort === 'title') {
      return [...arr].sort((a, b) =>
        String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })
      );
    }
    return arr; // `all` is already newest-first
  };

  function setScope(key) {
    if (!SCOPES.includes(key) || key === scope) return;
    scope = key;
    storage.set(SCOPE_KEY, scope);
    renderList();
  }

  function renderList() {
    // Chip counts reflect the current tag filter, so "Workspace 3" means three
    // workspace decks match what's actually shown.
    const tagFiltered = filterPresentationsByTags(all, selectedTags);
    for (const key of SCOPES) {
      const count = tagFiltered.filter((p) => inScope(p, key)).length;
      const btn = scopeButtons.get(key);
      btn.innerHTML = '';
      btn.append(
        h('span', { class: 'scope-filter-label', text: scopeLabel(key) }),
        h('span', { class: 'scope-filter-count', text: String(count) })
      );
      btn.classList.toggle('is-active', key === scope);
      btn.setAttribute('aria-selected', String(key === scope));
    }

    const filtered = sortList(tagFiltered.filter((p) => inScope(p, scope)));

    list.innerHTML = '';
    if (filtered.length === 0) {
      if (selectedTags.length > 0 || scope !== 'all') {
        list.append(
          h('div', { class: 'help', text: t('list.presentations.noMatch', 'No presentations match the selected filters.') })
        );
      } else if (typeof onCreate === 'function') {
        list.append(createNoPresentationsEmptyState({ h, onCreate }));
      } else {
        list.append(h('div', { class: 'help', text: t('list.presentations.empty', 'No presentations yet.') }));
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
