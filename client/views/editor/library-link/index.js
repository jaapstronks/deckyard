/**
 * Library links in the deck editor (B904, B905, D223, D368): a slide copied
 * from the library says so in a bar above the canvas.
 *
 * - **Locked** (D368): an item the reader may not change (`canEdit`, D170)
 *   keeps its copies as they are. The bar names the maker and offers one way
 *   out, **Unlink and edit**: after a confirmation the slide lets go of the
 *   item and is an ordinary slide. Next to it, **Comment** opens the item's
 *   thread with its maker (B906, D369), for a mistake that every deck with
 *   the slide should lose. The lock itself is the editor's
 *   `getSlideLockKind` seam ('library'), read through {@link lockOf}.
 * - **Newer revision** (B904): the slide's thumbnail is marked and the bar
 *   offers **View** (this deck's slide beside the newest version), **Update**
 *   (take the item's content in, keeping what belongs to the deck, D370; a
 *   deck language the item lacks is marked outdated, D371) and **Ignore**
 *   (set this revision aside; a later one is news again). A locked slide
 *   takes these too: they bring it closer to the item, not away from it.
 *
 * The items come from `GET /api/presentations/:id/library-links`, read when
 * the editor opens. Every choice is a deck edit like any other
 * (shared/slide-library/library-update.js), saved and undone with the deck.
 */

import { h } from '../../../lib/dom/index.js';
import { confirmModal } from '../../../lib/dom/modal.js';
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
  unlinkLibrarySlide,
} from '../../../../shared/slide-library/library-update.js';
import { openLibraryCompare } from './compare-modal.js';
import { openLibraryItemThread } from '../../slide-library/index.js';

/**
 * @param {Object} opts
 * @param {Function} opts.api - the editor's API client
 * @param {Object} opts.pres - the deck as the editor holds it
 * @param {Record<string, Object>} opts.SLIDE_TYPES
 * @param {() => string|null} opts.getSelectedSlideId
 * @param {(slide: Object) => HTMLElement} opts.renderSlide - a slide in the
 *   deck's theme and language, for the comparison
 * @param {() => boolean} opts.canEdit - whether the selected slide takes a
 *   library choice (Update, Ignore, Unlink): not read-only, not locked by
 *   anything but its library item
 * @param {() => void} opts.onChange - a slide took or set aside a revision,
 *   or was unlinked: mark the deck dirty and refresh the editor
 * @param {() => void} opts.onLoaded - the items arrived: refresh the slide
 *   list's markers and the lock
 * @returns {{ el: HTMLElement, load: () => Promise<void>,
 *   hasUpdate: (slideId: string) => boolean,
 *   lockOf: (slideId: string) => Object|null, sync: () => void,
 *   detach: () => void }}
 */
export function createLibraryLink({
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

  const linkedItem = (slide) => {
    const ref = normalizeLibraryRef(slide?.libraryRef);
    return ref ? { ref, item: items.get(ref.itemId) || null } : null;
  };

  /** The newer item revision this slide has not taken in or set aside. */
  const pendingItem = (slide) => {
    const link = linkedItem(slide);
    return link?.item && isNewerLibraryRevision(link.ref, link.item.revision)
      ? link.item
      : null;
  };

  /** The item that holds this slide, when the reader may not change it. */
  const lockingItem = (slide) => {
    const item = linkedItem(slide)?.item;
    return item && !item.canEdit ? item : null;
  };

  const lockText = h('p', { class: 'library-link-bar-text' });
  const unlinkBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary btn-sm',
    text: t('editor.libraryLink.unlink', 'Unlink and edit'),
    onclick: () => unlink(),
  });
  // Not disabled with the deck's write state: a comment changes the
  // thread, not this deck.
  const commentBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary btn-sm',
    text: t('editor.libraryLink.comment', 'Comment for the maker'),
    onclick: () => comment(),
  });
  const lockRow = h('div', { class: 'library-link-bar-row' }, [
    icon('library', { className: 'library-link-bar-icon' }),
    lockText,
    h('div', { class: 'library-link-bar-actions' }, [commentBtn, unlinkBtn]),
  ]);

  const message = h('p', { class: 'library-link-bar-text' });
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
  const updateRow = h('div', { class: 'library-link-bar-row' }, [
    icon('refresh-cw', { className: 'library-link-bar-icon' }),
    message,
    h('div', { class: 'library-link-bar-actions' }, [
      viewBtn,
      updateBtn,
      ignoreBtn,
    ]),
  ]);
  const el = h(
    'div',
    { class: 'library-link-bar', role: 'status', hidden: true },
    [lockRow, updateRow],
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

  function describeLock(item) {
    const maker = item.createdBy?.displayName || '';
    return maker
      ? t(
          'editor.libraryLink.locked',
          'From the library · {maker}. Changes come from the library; unlink to edit this slide here.',
          { maker },
        )
      : t(
          'editor.libraryLink.lockedNoMaker',
          'From the library. Changes come from the library; unlink to edit this slide here.',
        );
  }

  function sync() {
    const slide = slideById(getSelectedSlideId?.());
    const item = pendingItem(slide);
    const locking = lockingItem(slide);
    el.hidden = !item && !locking;
    lockRow.hidden = !locking;
    updateRow.hidden = !item;
    const editable = canEdit?.() !== false;
    if (locking) {
      lockText.textContent = describeLock(locking);
      unlinkBtn.disabled = !editable;
    }
    if (item) {
      message.textContent = describe(item);
      updateBtn.disabled = !editable;
      ignoreBtn.disabled = !editable;
    }
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

  async function unlink() {
    const slide = slideById(getSelectedSlideId?.());
    if (!lockingItem(slide) || canEdit?.() === false) return;
    const ok = await confirmModal(document.body, {
      title: t('editor.libraryLink.unlinkTitle', 'Unlink from the library?'),
      message: t(
        'editor.libraryLink.unlinkMessage',
        'This slide becomes an ordinary slide in this deck. You can edit it, and new versions from the library no longer reach it.',
      ),
      confirmLabel: t('editor.libraryLink.unlink', 'Unlink and edit'),
    });
    if (!ok || detached) return;
    if (!unlinkLibrarySlide(pres, slide.id)) return;
    onChange();
  }

  function comment() {
    const item = lockingItem(slideById(getSelectedSlideId?.()));
    if (item) openLibraryItemThread({ api, item });
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
        `/api/presentations/${encodeURIComponent(pres.id)}/library-links`,
      );
      if (detached) return;
      items.clear();
      for (const item of res?.items || []) items.set(item.id, item);
      sync();
      onLoaded?.();
    } catch (err) {
      // A notice, not a blocker: the deck edits fine without it, and an
      // unread lock is no lock (D368 guards against drift, not access).
      debugLog('[library-link] load failed', err);
    }
  }

  return {
    el,
    load,
    sync,
    hasUpdate: (slideId) => !!pendingItem(slideById(slideId)),
    lockOf: (slideId) => lockingItem(slideById(slideId)),
    detach: () => {
      detached = true;
      el.remove();
    },
  };
}
