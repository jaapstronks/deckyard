/**
 * Library updates in the deck editor (B904, D223): a slide copied from the
 * library whose item has a newer revision says so, on its thumbnail and in a
 * bar above the canvas, and the deck's editor chooses:
 *
 * - **View**: the slide as it is in this deck beside the newest version.
 * - **Update**: take the item's content in, keeping what belongs to the deck
 *   (D370); a deck language the item lacks is marked outdated (D371).
 * - **Ignore**: set this revision aside; a later one is news again.
 *
 * The revisions come from `GET /api/presentations/:id/library-updates`, read
 * when the editor opens. The decision itself is a deck edit like any other
 * (shared/slide-library/library-update.js), saved and undone with the deck.
 */

import { h } from '../../../lib/dom/index.js';
import { icon } from '../../../lib/dom/icons.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { formatDate } from '../../../lib/format/analytics-format.js';
import { debugLog } from '../../../lib/state/debug.js';
import { getLangDisplayName } from '../../../../shared/i18n-utils.js';
import {
  isNewerLibraryRevision,
  normalizeLibraryRef,
} from '../../../../shared/slide-library/library-ref.js';
import {
  applyLibraryRevision,
  ignoreLibraryRevision,
} from '../../../../shared/slide-library/library-update.js';
import { openLibraryCompare } from './compare-modal.js';

/**
 * @param {Object} opts
 * @param {Function} opts.api - the editor's API client
 * @param {Object} opts.pres - the deck as the editor holds it
 * @param {Record<string, Object>} opts.SLIDE_TYPES
 * @param {() => string|null} opts.getSelectedSlideId
 * @param {(slide: Object) => HTMLElement} opts.renderSlide - a slide in the
 *   deck's theme and language, for the comparison
 * @param {() => boolean} opts.canEdit - whether the selected slide takes edits
 * @param {() => void} opts.onChange - a slide took or set aside a revision:
 *   mark the deck dirty and refresh the editor
 * @param {() => void} opts.onLoaded - the revisions arrived: refresh the
 *   slide list's markers
 * @returns {{ el: HTMLElement, load: () => Promise<void>,
 *   hasUpdate: (slideId: string) => boolean, sync: () => void,
 *   detach: () => void }}
 */
export function createLibraryUpdates({
  api,
  pres,
  SLIDE_TYPES,
  getSelectedSlideId,
  renderSlide,
  canEdit,
  onChange,
  onLoaded,
}) {
  /** @type {Map<string, Object>} itemId → the item at its newest revision */
  const items = new Map();
  let detached = false;

  const slideById = (slideId) =>
    (pres?.slides || []).find((s) => s?.id === slideId) || null;

  /** The newer item revision this slide has not taken in or set aside. */
  const pendingItem = (slide) => {
    const ref = normalizeLibraryRef(slide?.libraryRef);
    const item = ref ? items.get(ref.itemId) : null;
    return item && isNewerLibraryRevision(ref, item.revision) ? item : null;
  };

  const message = h('p', { class: 'library-update-bar-text' });
  const viewBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary btn-sm',
    text: t('editor.libraryUpdate.view', 'View'),
    onclick: () => view(),
  });
  const updateBtn = h('button', {
    type: 'button',
    class: 'btn btn-primary btn-sm',
    text: t('editor.libraryUpdate.update', 'Update'),
    onclick: () => update(),
  });
  const ignoreBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary btn-sm',
    text: t('editor.libraryUpdate.ignore', 'Ignore'),
    onclick: () => ignore(),
  });
  const el = h(
    'div',
    {
      class: 'library-update-bar',
      role: 'status',
      hidden: true,
    },
    [
      icon('refresh-cw', { className: 'library-update-bar-icon' }),
      message,
      h('div', { class: 'library-update-bar-actions' }, [
        viewBtn,
        updateBtn,
        ignoreBtn,
      ]),
    ],
  );

  function describe(item) {
    const who = item.updatedBy?.displayName || '';
    const when = item.updatedAt
      ? formatDate(item.updatedAt, { day: 'numeric', month: 'short' })
      : '';
    return t(
      'editor.libraryUpdate.message',
      'A newer version of “{name}” is in the library ({who}, {when}).',
      { name: item.name || '', who, when },
    );
  }

  function sync() {
    const slide = slideById(getSelectedSlideId?.());
    const item = pendingItem(slide);
    el.hidden = !item;
    if (!item) return;
    message.textContent = describe(item);
    const editable = canEdit?.() !== false;
    updateBtn.disabled = !editable;
    ignoreBtn.disabled = !editable;
  }

  function current() {
    const slide = slideById(getSelectedSlideId?.());
    const item = pendingItem(slide);
    return slide && item ? { slide, item } : null;
  }

  function update() {
    const hit = current();
    if (!hit || canEdit?.() === false) return;
    const res = applyLibraryRevision(pres, hit.slide.id, hit.item, {
      slideTypes: SLIDE_TYPES,
    });
    if (!res) return;
    onChange();
    if (res.outdated.length) {
      toast.info(
        t(
          'editor.libraryUpdate.outdated',
          'Updated. {langs} kept the old text and is marked as outdated.',
          { langs: res.outdated.map(getLangDisplayName).join(', ') },
        ),
      );
    } else {
      toast.success(t('editor.libraryUpdate.updated', 'Slide updated.'));
    }
  }

  function ignore() {
    const hit = current();
    if (!hit || canEdit?.() === false) return;
    if (!ignoreLibraryRevision(pres, hit.slide.id, hit.item.revision)) return;
    onChange();
  }

  function view() {
    const hit = current();
    if (!hit) return;
    openLibraryCompare({
      slide: hit.slide,
      item: hit.item,
      pres,
      renderSlide,
      canEdit: canEdit?.() !== false,
      onUpdate: update,
    });
  }

  async function load() {
    try {
      const res = await api(
        `/api/presentations/${encodeURIComponent(pres.id)}/library-updates`,
      );
      if (detached) return;
      items.clear();
      for (const item of res?.items || []) items.set(item.id, item);
      sync();
      onLoaded?.();
    } catch (err) {
      // A notice, not a blocker: the deck edits fine without it.
      debugLog('[library-updates] load failed', err);
    }
  }

  return {
    el,
    load,
    sync,
    hasUpdate: (slideId) => !!pendingItem(slideById(slideId)),
    detach: () => {
      detached = true;
      el.remove();
    },
  };
}
