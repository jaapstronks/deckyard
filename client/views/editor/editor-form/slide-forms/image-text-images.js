/**
 * The image-text slide's slide-level image COLLECTION section.
 *
 * DOCUMENTED EXCEPTION (editor-behaviour-abstraction step 5). Everything else
 * this module used to hold is gone: the per-cell card is the shared "This
 * image" element card (image-element-card.js, descriptor-driven), and the bulk
 * "Edit all text" modal renders `images` through the one generic collection
 * editor, driven by the field's `itemFields` declarations. What is left is the
 * slim manager for the inspector's Slide tab: thumbnails plus
 * reorder/remove/add, and DELIBERATELY no per-image settings — those live in
 * the element tab, one home per setting.
 *
 * Why it is not declarable, stated once so the next pass does not re-litigate:
 *
 * 1. "Collection chrome without item fields" is a difference between
 *    SURFACES, not between types. A field declaration is read by both
 *    surfaces by design (that is the whole point of the vocabulary), so it is
 *    structurally the wrong axis to express "here, but not there".
 * 2. The number of visible cells comes from `layout` via
 *    `imageTextCellCount` (rows follow the image count, duo is fixed at two,
 *    split/corner show one), not from `minItems`/`maxItems`. A
 *    computed-cardinality declaration would have exactly one declarant, which
 *    is a vocabulary of one — more expensive than this exception.
 *
 * Items beyond the active layout's cell count stay in the content (switching
 * layouts remembers the images) but are not listed here.
 */
import { t } from '../../../../lib/ui-i18n.js';
import {
  IMAGE_TEXT_MAX_IMAGES,
  ensureImageTextImages,
  imageTextCellCount,
} from '../../../../../shared/slide-types/types/image-text-slide/images.js';

/**
 * Reorder/add/remove wiring for the images collection.
 */
function collectionActions({ content, markDirty, rerenderEditor, scheduleUiRefresh }) {
  const images = content.images;
  const refresh = () => {
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };
  return {
    swap: (a, b) => {
      if (a < 0 || b < 0 || a >= images.length || b >= images.length) return;
      const tmp = images[a];
      images[a] = images[b];
      images[b] = tmp;
      refresh();
    },
    addImage: () => {
      images.push({ src: '', alt: '' });
      refresh();
    },
    removeImage: (i) => {
      images.splice(i, 1);
      ensureImageTextImages(content);
      refresh();
    },
  };
}

/** The ↑ / ↓ / × buttons for cell i, or null when none apply. */
function cellControlButtons({ h, content, i, cellCount, isRow, actions }) {
  const controls = h('div', { class: 'row' });
  if (i > 0) {
    controls.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-icon',
        text: '↑',
        title: t('editor.gallery.dragToReorder', 'Reorder'),
        onclick: () => actions.swap(i, i - 1),
      })
    );
  }
  if (i < cellCount - 1) {
    controls.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-icon',
        text: '↓',
        title: t('editor.gallery.dragToReorder', 'Reorder'),
        onclick: () => actions.swap(i, i + 1),
      })
    );
  }
  // Rows above the minimum can drop an image entirely (fewer columns);
  // fixed-cell layouts clear per image via the canvas/media popover.
  if (isRow && content.images.length > 2) {
    controls.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-icon card-remove-btn',
        text: '×',
        title: t('editor.imageText.removeImage', 'Remove image'),
        'aria-label': t('editor.imageText.removeImageN', 'Remove image {n}', { n: i + 1 }),
        onclick: () => actions.removeImage(i),
      })
    );
  }
  return controls.childNodes.length ? controls : null;
}

/**
 * Slim slide-level collection manager (inspector Slide tab): one thumbnail
 * row per cell with reorder/remove, plus "+ Add image" in the row model.
 * Deliberately NO per-image settings — alt/fit/focus live in the "This
 * image" element tab (every setting in exactly one place). Returns null when
 * there is no collection to manage (single fixed cell).
 *
 * @param {Object} opts - h, slide, used + edit hooks
 * @returns {HTMLElement|null}
 */
export function renderImageTextCollectionSection({
  h,
  slide,
  used,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  const content = slide?.content;
  if (!content || typeof content !== 'object') return null;
  // The content is already canonical here (normalizeContent runs on open); this
  // only claims the keys so the generic keeps loop leaves them alone.
  used?.add('image');
  used?.add('images');
  used?.add('alt');

  const images = Array.isArray(content.images) ? content.images : [];
  const layout = String(content.layout || 'split');
  const isRow = layout === 'row-top' || layout === 'row-bottom';
  const cellCount = imageTextCellCount(content);
  const canAdd = isRow && images.length < IMAGE_TEXT_MAX_IMAGES;
  // A single fixed cell has nothing to add, remove or reorder; the element
  // tab (and the canvas) fully cover it.
  if (cellCount < 2 && !canAdd) return null;

  const actions = collectionActions({ content, markDirty, rerenderEditor, scheduleUiRefresh });

  const wrap = h('div', { class: 'stack' });
  const headerRow = h('div', { class: 'row is-between' });
  headerRow.append(
    h('div', { class: 'field-label', text: t('editor.imageText.images', 'Images') })
  );
  if (canAdd) {
    headerRow.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        text: t('editor.imageText.addImage', '+ Add image'),
        onclick: () => actions.addImage(),
      })
    );
  }
  wrap.append(headerRow);

  for (let i = 0; i < cellCount; i += 1) {
    const image = images[i] || {};
    const rowEl = h('div', { class: 'row is-between image-collection-row' });
    const left = h('div', { class: 'row' });
    const src = String(image.src || '').trim();
    left.append(
      src
        ? h('img', {
            class: 'editor-collection-thumb',
            src,
            alt: '',
          })
        : h('div', { class: 'editor-collection-thumb is-empty' })
    );
    left.append(
      h('div', {
        class: 'card-group-title',
        text: t('editor.imageText.imageN', 'Image {n}', { n: i + 1 }),
      })
    );
    rowEl.append(left);
    const controls = cellControlButtons({ h, content, i, cellCount, isRow, actions });
    if (controls) rowEl.append(controls);
    wrap.append(rowEl);
  }

  wrap.append(
    h('p', {
      class: 'help',
      text: t(
        'editor.imageText.collectionHelp',
        'Click an image on the slide to edit its alt text, fit and focus.'
      ),
    })
  );

  return wrap;
}
