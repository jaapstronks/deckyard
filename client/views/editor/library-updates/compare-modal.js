/**
 * "View" on a library update (B904): the slide as it is in this deck beside
 * the item's newest version, both in the deck's theme and in the language
 * being edited, with Update at hand.
 */

import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { createModal } from '../../../lib/dom/modal.js';
import { attachThumbScale } from '../../../lib/slide-runtime/thumb-scale.js';
import { resolveDeckLang } from '../../../../shared/i18n-utils.js';
import { libraryItemContentFor } from '../../../../shared/slide-library/library-update.js';

/**
 * One labelled, scaled slide.
 * @returns {{ el: HTMLElement, detach: () => void }}
 */
function comparePane(label, slideEl) {
  const thumb = h('div', { class: 'thumb library-compare-thumb' }, [slideEl]);
  const el = h('figure', { class: 'library-compare-pane' }, [
    h('figcaption', { class: 'field-label', text: label }),
    thumb,
  ]);
  return { el, detach: attachThumbScale(thumb) };
}

/**
 * @param {Object} opts
 * @param {Object} opts.slide - the deck slide
 * @param {Object} opts.item - the item at its newest revision
 * @param {Object} opts.pres
 * @param {(slide: Object) => HTMLElement} opts.renderSlide
 * @param {boolean} opts.canEdit
 * @param {() => void} opts.onUpdate
 */
export function openLibraryCompare({
  slide,
  item,
  pres,
  renderSlide,
  canEdit,
  onUpdate,
}) {
  const lang = resolveDeckLang(pres);
  const newest = {
    ...slide,
    type: item.slideType || slide.type,
    content: libraryItemContentFor(item, lang) || item.content || {},
  };
  const panes = [
    comparePane(
      t('editor.libraryUpdate.compareCurrent', 'In this deck'),
      renderSlide(slide),
    ),
    comparePane(
      t('editor.libraryUpdate.compareNewest', 'Newest version'),
      renderSlide(newest),
    ),
  ];

  const modal = createModal({
    title: t('editor.libraryUpdate.compareTitle', 'Compare with the library'),
    hint: item.name || '',
    modalClass: 'library-compare-modal',
    onClose: () => panes.forEach((p) => p.detach()),
  });
  const actions = h('div', { class: 'row is-end modal-actions' }, [
    h('button', {
      type: 'button',
      class: 'btn btn-secondary',
      text: t('common.close', 'Close'),
      onclick: () => modal.close(),
    }),
  ]);
  if (canEdit) {
    actions.append(
      h('button', {
        type: 'button',
        class: 'btn btn-primary',
        text: t('editor.libraryUpdate.update', 'Update'),
        onclick: () => {
          modal.close();
          onUpdate();
        },
      }),
    );
  }
  modal.append(
    h(
      'div',
      { class: 'library-compare' },
      panes.map((p) => p.el),
    ),
    actions,
  );
  modal.show(document.body);
}
