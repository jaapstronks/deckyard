/**
 * Visual icon picker modal.
 *
 * Opens a searchable, category-filtered grid of Lucide icons. Search matches
 * both the icon name and its Lucide keyword tags. Recently picked icons are
 * remembered in localStorage and surfaced at the top.
 */

import {
  ICON_CATEGORIES,
  ICON_NAMES,
  iconUrl,
  resolveIconName,
} from '../../../../shared/icon-names.js';
import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { openModal } from '../../../lib/dom/modal.js';

const RECENT_KEY = 'deckyard:recent-icons';
const RECENT_MAX = 18;

/** @type {Record<string, string[]>|null} */
let tagsCache = null;

/**
 * Lazily fetch the (trimmed) Lucide keyword tags used for search.
 * @returns {Promise<Record<string, string[]>>}
 */
async function loadTags() {
  if (tagsCache) return tagsCache;
  try {
    const res = await fetch('/client/vendor/lucide-icons/tags.json');
    tagsCache = res.ok ? await res.json() : {};
  } catch {
    tagsCache = {};
  }
  return tagsCache;
}

/** @returns {string[]} Recently picked icon names (validated, most-recent first). */
function getRecent() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    const valid = new Set(ICON_NAMES);
    return arr.filter((n) => valid.has(n));
  } catch {
    return [];
  }
}

/** Record an icon as recently used. @param {string} name */
function pushRecent(name) {
  try {
    const next = [name, ...getRecent().filter((n) => n !== name)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — non-fatal
  }
}

/**
 * Open the icon picker.
 * @param {Object} opts
 * @param {string} [opts.current] - Currently selected icon name
 * @param {(name: string) => void} opts.onSelect - Called with the chosen icon name
 */
export function openIconPicker({ current = '', onSelect } = {}) {
  const selectedName = resolveIconName(current);

  const modal = openModal(h, document.body, {
    title: t('editor.iconPicker.title', 'Choose an icon'),
    modalClass: 'icon-picker-modal',
  });

  // --- Controls -------------------------------------------------------------
  const search = h('input', {
    class: 'form-input icon-picker-search',
    type: 'search',
    placeholder: t('editor.iconPicker.searchPlaceholder', 'Search icons…'),
    autocomplete: 'off',
    spellcheck: 'false',
  });

  let activeCategory = 'all';
  const chipRow = h('div', { class: 'icon-picker-chips' });
  const chips = [];
  const addChip = (key, label) => {
    const chip = h('button', {
      type: 'button',
      class: 'icon-picker-chip',
      text: label,
      onclick: () => {
        activeCategory = key;
        for (const c of chips) c.el.classList.toggle('is-active', c.key === key);
        search.value = '';
        rebuild();
        search.focus();
      },
    });
    chips.push({ key, el: chip });
    chipRow.append(chip);
  };
  addChip('all', t('editor.iconPicker.allCategory', 'All'));
  for (const cat of ICON_CATEGORIES) addChip(cat.key, cat.label);
  chips[0].el.classList.add('is-active');

  const grid = h('div', {
    class: 'icon-picker-grid',
    role: 'listbox',
    'aria-label': t('editor.iconPicker.title', 'Choose an icon'),
  });
  const sectionLabel = h('div', { class: 'icon-picker-section-label' });

  modal.append(search, chipRow, sectionLabel, grid);

  // --- Selection ------------------------------------------------------------
  const choose = (name) => {
    pushRecent(name);
    onSelect?.(name);
    modal.close();
  };

  // --- Grid rendering -------------------------------------------------------
  let cells = [];

  /** Build one icon cell button. @param {string} name */
  const makeCell = (name) => {
    const cell = h('button', {
      type: 'button',
      class: 'icon-picker-cell',
      role: 'option',
      title: name,
      'aria-label': name,
      tabindex: '-1',
      onclick: () => choose(name),
    });
    if (name === selectedName) {
      cell.classList.add('is-selected');
      cell.setAttribute('aria-selected', 'true');
    }
    cell.append(h('img', { class: 'icon-picker-cell-img', src: iconUrl(name), alt: '' }));
    return cell;
  };

  const renderNames = (names) => {
    grid.innerHTML = '';
    cells = names.map(makeCell);
    if (cells.length === 0) {
      grid.append(
        h('div', {
          class: 'icon-picker-empty help',
          text: t('editor.iconPicker.noResults', 'No icons match your search.'),
        })
      );
      return;
    }
    grid.append(...cells);
    // Roving tabindex: first cell (or the selected one) is the tab stop.
    const initial = cells.find((c) => c.classList.contains('is-selected')) || cells[0];
    initial.tabIndex = 0;
  };

  const matchesQuery = (name, query, tags) => {
    if (name.includes(query)) return true;
    const list = tags[name];
    return Array.isArray(list) && list.some((tag) => tag.includes(query));
  };

  const rebuild = () => {
    const query = search.value.trim().toLowerCase();
    const tags = tagsCache || {};

    // No search, "All" category → show Recent + every category in order.
    if (!query && activeCategory === 'all') {
      const recent = getRecent();
      if (recent.length) {
        sectionLabel.textContent = t('editor.iconPicker.recent', 'Recently used');
        renderNames([...recent, ...ICON_NAMES.filter((n) => !recent.includes(n))]);
      } else {
        sectionLabel.textContent = '';
        renderNames(ICON_NAMES);
      }
      return;
    }

    // Category scope, then optional text filter within it.
    let base = ICON_NAMES;
    if (activeCategory !== 'all') {
      const cat = ICON_CATEGORIES.find((c) => c.key === activeCategory);
      base = cat ? cat.icons : [];
      sectionLabel.textContent = cat ? cat.label : '';
    } else {
      sectionLabel.textContent = '';
    }
    const names = query ? base.filter((n) => matchesQuery(n, query, tags)) : base;
    if (query) sectionLabel.textContent = '';
    renderNames(names);
  };

  search.addEventListener('input', rebuild);

  // --- Keyboard navigation across the grid ---------------------------------
  const columnCount = () => {
    if (cells.length < 2) return 1;
    const top = cells[0].offsetTop;
    let cols = 0;
    for (const c of cells) {
      if (c.offsetTop !== top) break;
      cols += 1;
    }
    return Math.max(1, cols);
  };

  const focusCell = (index) => {
    if (!cells.length) return;
    const clamped = Math.max(0, Math.min(cells.length - 1, index));
    for (const c of cells) c.tabIndex = -1;
    cells[clamped].tabIndex = 0;
    cells[clamped].focus();
  };

  grid.addEventListener('keydown', (e) => {
    const idx = cells.indexOf(document.activeElement);
    if (idx === -1) return;
    const cols = columnCount();
    let next = null;
    if (e.key === 'ArrowRight') next = idx + 1;
    else if (e.key === 'ArrowLeft') next = idx - 1;
    else if (e.key === 'ArrowDown') next = idx + cols;
    else if (e.key === 'ArrowUp') next = idx - cols < 0 ? idx : idx - cols;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = cells.length - 1;
    else return;
    e.preventDefault();
    focusCell(next);
  });

  // Down-arrow from the search box jumps into the grid.
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && cells.length) {
      e.preventDefault();
      focusCell(0);
    }
  });

  // Initial paint (sync first, then refine once tags load for search).
  rebuild();
  loadTags().then(() => {
    /* tags now cached; future searches include keywords */
  });
  setTimeout(() => search.focus(), 0);
}
