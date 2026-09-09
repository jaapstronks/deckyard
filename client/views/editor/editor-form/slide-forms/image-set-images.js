/**
 * The image-set slide's slide-level image COLLECTION section.
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
 * "collection chrome without item fields" is a difference between SURFACES,
 * not between types. A field declaration is read by both surfaces by design
 * (that is the whole point of the vocabulary), so it is structurally the wrong
 * axis to express "here, but not there".
 *
 * The second reason this file used to give is gone with D100. Cardinality was
 * computed from `layout` (`imageTextCellCount`: rows followed the image count,
 * duo was fixed at two, split/corner showed one) because one type carried two
 * contracts. `image-set-slide` carries one: 2-3 images in every layout, stated
 * as `minItems`/`maxItems` on the field, which is what this section reads.
 *
 * The `editor.imageText.*` copy keys are shared vocabulary, not a leftover:
 * image-slide reads `editor.imageText.imageFit` too. They name image chrome,
 * not a slide type.
 */
import { t } from '../../../../lib/ui-i18n.js';
import {
  IMAGE_SET_MAX_IMAGES,
  IMAGE_SET_MIN_IMAGES,
  ensureImageSetImages,
  imageSetCellCount,
} from '../../../../../shared/slide-types/types/image-set-slide/images.js';
import { h } from '../../../../lib/dom.js';

/**
 * Reorder/add/remove wiring for the images collection.
 */
function collectionActions({
  content,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
}) {
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
      ensureImageSetImages(content);
      refresh();
    },
  };
}

/** The ↑ / ↓ / × buttons for cell i, or null when none apply. */
function cellControlButtons({ i, cellCount, canRemove, actions }) {
  const controls = h('div', { class: 'row' });
  if (i > 0) {
    controls.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-icon',
        text: '↑',
        title: t('editor.gallery.dragToReorder', 'Drag to reorder'),
        onclick: () => actions.swap(i, i - 1),
      }),
    );
  }
  if (i < cellCount - 1) {
    controls.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-icon',
        text: '↓',
        title: t('editor.gallery.dragToReorder', 'Drag to reorder'),
        onclick: () => actions.swap(i, i + 1),
      }),
    );
  }
  // Above the minimum an image can go entirely (one cell fewer); at the
  // minimum the only way to empty a cell is the canvas/media popover, because
  // the type has no shape with fewer than two images.
  if (canRemove) {
    controls.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-icon card-remove-btn',
        text: '×',
        title: t('editor.imageText.removeImage', 'Remove image'),
        'aria-label': t('editor.imageText.removeImageN', 'Remove image {n}', {
          n: i + 1,
        }),
        onclick: () => actions.removeImage(i),
      }),
    );
  }
  return controls.childNodes.length ? controls : null;
}

/**
 * Slim slide-level collection manager (inspector Slide tab): one thumbnail
 * row per cell with reorder/remove, plus "+ Add image" while under the
 * maximum. Deliberately NO per-image settings — alt/fit/focus live in the
 * "This image" element tab (every setting in exactly one place).
 *
 * @param {Object} opts - slide, used + edit hooks
 * @returns {HTMLElement|null}
 */
function renderImageSetCollectionSection({
  slide,
  used,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  const content = slide?.content;
  if (!content || typeof content !== 'object') return null;
  // The content is already canonical here (normalizeContent runs on open); this
  // only claims the key so the generic keeps loop leaves it alone.
  used?.add('images');

  const images = Array.isArray(content.images) ? content.images : [];
  const cellCount = imageSetCellCount(content);
  const canAdd = images.length < IMAGE_SET_MAX_IMAGES;
  const canRemove = images.length > IMAGE_SET_MIN_IMAGES;

  const actions = collectionActions({
    content,
    markDirty,
    rerenderEditor,
    scheduleUiRefresh,
  });

  const wrap = h('div', { class: 'stack' });
  const headerRow = h('div', { class: 'row is-between' });
  headerRow.append(
    h('div', {
      class: 'field-label',
      text: t('editor.imageText.images', 'Images'),
    }),
  );
  if (canAdd) {
    headerRow.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        text: t('editor.imageText.addImage', '+ Add image'),
        onclick: () => actions.addImage(),
      }),
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
        : h('div', { class: 'editor-collection-thumb is-empty' }),
    );
    left.append(
      h('div', {
        class: 'card-group-title',
        text: t('editor.imageText.imageN', 'Image {n}', { n: i + 1 }),
      }),
    );
    rowEl.append(left);
    const controls = cellControlButtons({
      i,
      cellCount,
      canRemove,
      actions,
    });
    if (controls) rowEl.append(controls);
    wrap.append(rowEl);
  }

  wrap.append(
    h('p', {
      class: 'help',
      text: t(
        'editor.imageText.collectionHelp',
        'Click an image on the slide to edit its alt text, fit and focus.',
      ),
    }),
  );

  return wrap;
}

/**
 * The INSPECTOR_EXTRAS entry (inspector-form.js): the collection manager into
 * the inspector's Slide tab. The selected cell's card is NOT rendered here —
 * image-set declares `elementTab: { image: … }` like every other image type,
 * so the shared "This image" card comes from the declaration-driven rule.
 *
 * @param {Object} ctx - Same context shape as renderSlideFormByType
 */
export function renderImageSetCollectionExtra(ctx) {
  const { form, slide, used, markDirty, rerenderEditor, scheduleUiRefresh } =
    ctx;
  const section = renderImageSetCollectionSection({
    slide,
    used,
    markDirty,
    rerenderEditor,
    scheduleUiRefresh,
  });
  if (section) form.append(section);
}
