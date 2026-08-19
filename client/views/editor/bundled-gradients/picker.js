/**
 * Picker for the bundled gradient library.
 *
 * Deliberately the smallest picker in the editor: the whole library is a few
 * dozen static assets that ship with the app, so there is nothing to search,
 * paginate, upload or attribute. One manifest request, one grid, one click.
 * The only affordance is a tone filter — a light gradient and a dark one need
 * opposite text colours, and that is the choice a user actually makes here.
 *
 * A pick is the asset URL as-is. Nothing is copied into the image library:
 * `/assets/gradients/*` is already served and already inlined by the export
 * paths, so a copy would only add a second address for the same bytes.
 */
import { t } from '../../../lib/ui-i18n.js';
import { openModal } from '../../../lib/dom/modal.js';
import { fetchBundledGradients } from '../../../lib/net/stock-media.js';
import { lockDocumentScroll } from '../editor-utils.js';

/** @type {Array<Object>|null} Manifest is immutable per deploy; fetch once. */
let manifestCache = null;

// Thunks rather than key strings: a `t(variable)` call is invisible to the
// extractor, so the filter labels would never reach a translator.
const TONES = [
  { id: 'all', label: () => t('stockMedia.gradients.tone.all', 'All') },
  { id: 'dark', label: () => t('stockMedia.gradients.tone.dark', 'Dark') },
  { id: 'light', label: () => t('stockMedia.gradients.tone.light', 'Light') },
];

/**
 * @param {Object} opts
 * @param {Function} opts.h
 * @param {HTMLElement} opts.root
 * @param {Set<Function>} [opts.openOverlayClosers]
 * @param {string} [opts.title]
 * @param {(picked: { url: string, alt: string, tags: string[], meta: Object }) => void} opts.onPick
 */
export function openBundledGradientPicker({
  h,
  root,
  openOverlayClosers,
  title = t('stockMedia.gradients.title', 'Gradients'),
  onPick,
} = {}) {
  if (typeof h !== 'function')
    throw new Error('openBundledGradientPicker: h is required');
  if (!root) throw new Error('openBundledGradientPicker: root is required');

  const unlockScroll = lockDocumentScroll();
  let tone = 'all';

  const modalApi = openModal(
    h,
    root,
    {
      title,
      hint: t(
        'stockMedia.gradients.hint',
        'Abstract backgrounds generated from the built-in themes. No attribution needed.',
      ),
      modalClass: 'gradient-picker-modal',
      onClose: () => unlockScroll(),
    },
    openOverlayClosers,
  );

  const statusLine = h('div', { class: 'help ui-status-line' });
  const filterBar = h('div', { class: 'row gradient-picker-filters' });
  const grid = h('div', { class: 'stock-media-grid gradient-picker-grid' });

  const renderFilters = () => {
    filterBar.innerHTML = '';
    for (const opt of TONES) {
      filterBar.append(
        h('button', {
          type: 'button',
          class: `btn btn-secondary${tone === opt.id ? ' is-active' : ''}`,
          'aria-pressed': tone === opt.id ? 'true' : 'false',
          text: opt.label(),
          onclick: () => {
            tone = opt.id;
            renderFilters();
            renderGrid();
          },
        }),
      );
    }
  };

  const pick = (item) => {
    onPick?.({
      url: item.url,
      alt: item.alt,
      tags: Array.isArray(item.tags) ? item.tags : undefined,
      meta: {
        source: 'bundled-gradient',
        id: item.id,
        description: item.label,
        tone: item.tone,
      },
    });
    modalApi.close();
  };

  const renderGrid = () => {
    grid.innerHTML = '';
    const items = (manifestCache || []).filter(
      (it) => tone === 'all' || it.tone === tone,
    );
    if (!items.length) {
      grid.append(
        h('div', {
          class: 'stock-media-empty',
          text: t('stockMedia.gradients.empty', 'No gradients available.'),
        }),
      );
      return;
    }
    for (const item of items) {
      grid.append(
        h(
          'button',
          {
            type: 'button',
            class: 'stock-media-item gradient-picker-item',
            title: item.label,
            'aria-label': item.label,
            onclick: () => pick(item),
          },
          [
            h('img', {
              src: item.url,
              alt: '',
              loading: 'lazy',
              width: 320,
              height: 180,
            }),
            h('span', { class: 'gradient-picker-label', text: item.label }),
          ],
        ),
      );
    }
    statusLine.textContent = t(
      'stockMedia.gradients.count',
      '{count} gradients',
      { count: items.length },
    );
  };

  modalApi.append(statusLine, filterBar, grid);
  renderFilters();

  const load = async () => {
    if (manifestCache) {
      renderGrid();
      return;
    }
    statusLine.textContent = t(
      'stockMedia.gradients.loading',
      'Loading gradients...',
    );
    try {
      manifestCache = await fetchBundledGradients();
      renderGrid();
    } catch {
      statusLine.textContent = t(
        'stockMedia.gradients.loadFailed',
        'Could not load the gradient library.',
      );
    }
  };
  load();

  return modalApi;
}
