/**
 * Image editing surfaces for the image-text slide.
 *
 * Three renderers, one per surface (editing-surfaces track):
 * - renderImageTextCellCard: ONE cell's controls (picker, alt, per-image fit,
 *   focus) for the inspector's "This image" element tab — flat, no header.
 * - renderImageTextCollectionSection: the slim slide-level collection manager
 *   (thumbnails, add for the row model, reorder, remove) WITHOUT per-image
 *   settings — those live in the element tab only.
 * - renderImageTextImagesSection: the full manager (collection + per-image
 *   settings in one list) for the bulk "Edit all text" modal, which has no
 *   element selection to route through.
 *
 * Rows can add a third image (the row model: the number of images sets the
 * columns); duo/split/corner have a fixed cell count, so no add button
 * there. Items beyond the active layout's cell count are kept in content
 * (switching layouts remembers the images) but not shown here.
 *
 * Calling any of these also canonicalizes the content via
 * ensureImageTextImages: legacy flat `image` migrates into images[0] and every
 * rendered cell gets a live item behind it (the WYSIWYG media popover mutates
 * `images[idx]`).
 */
import { renderImagePositionPicker } from '../image-position-picker.js';
import { renderFocusGridField } from '../focus-picker.js';
import { t } from '../../../../lib/ui-i18n.js';
import {
  IMAGE_TEXT_MAX_IMAGES,
  IMAGE_TEXT_IMAGE_DEFAULTS,
  ensureImageTextImages,
  imageTextCellCount,
  resolveImageTextCell,
} from '../../../../../shared/slide-types/image-text-images.js';

/**
 * Canonicalize the slide content and mark the image keys used, or return null
 * when there is nothing to render into. Shared entry guard for all three
 * renderers.
 */
function prepareContent(slide, used) {
  const content = slide?.content;
  if (!content || typeof content !== 'object') return null;
  ensureImageTextImages(content);
  used?.add('image');
  used?.add('images');
  used?.add('alt');
  return content;
}

/**
 * The per-cell controls (picker, alt, fit, focus) for images[idx], appended
 * to `card`. The single source for both the element tab and the bulk-modal
 * manager, so the two surfaces cannot drift.
 */
function appendCellControls({
  h,
  card,
  slide,
  content,
  idx,
  fieldGrid,
  fieldText,
  fieldEnum,
  fieldImage,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
}) {
  const images = content.images;
  const image = images[idx] || {};

  // Image picker via the proxy-slide pattern (same as the gallery form):
  // fieldImage edits `content.src` on the proxy, which lands on the item.
  const proxySlide = {
    type: slide.type,
    id: slide.id,
    content: image,
  };
  if (typeof fieldImage === 'function') {
    card.append(
      fieldImage(
        proxySlide,
        { key: 'src', label: t('editor.imageText.image', 'Image'), type: 'image', hideHelp: true },
        (url) => {
          images[idx].src = url;
          markDirty?.();
          rerenderEditor?.();
          scheduleUiRefresh?.();
        }
      )
    );
  }

  // Item 0 of a migrated legacy slide keeps its alt at the slide level (so
  // alt translations survive); surface that effective value as a
  // placeholder instead of showing a misleading empty field.
  const slideAltFallback =
    idx === 0 && typeof content.alt === 'string' ? content.alt.trim() : '';
  const altEl =
    typeof fieldText === 'function'
      ? fieldText(
          t('editor.imageText.altText', 'Alt text'),
          typeof image.alt === 'string' ? image.alt : '',
          (v) => {
            images[idx].alt = v;
            markDirty?.();
            scheduleUiRefresh?.();
          },
          slideAltFallback ? { placeholder: slideAltFallback } : {}
        )
      : null;
  // Per-image fit (canonical since step 2b). Empty = follow the type
  // default, so the empty option surfaces the derived value plus its origin
  // ("slide type") and doubles as the back-to-default that empties the
  // field - the default is looked up, never written into the item.
  const typeFitLabel =
    IMAGE_TEXT_IMAGE_DEFAULTS.fit === 'contain'
      ? t('editor.imageText.fitContain', 'Fit (no crop)')
      : t('editor.imageText.fitCover', 'Fill (crop)');
  const fitEl =
    typeof fieldEnum === 'function'
      ? fieldEnum(
          {
            key: 'fit',
            label: t('editor.imageText.imageFit', 'Image fit'),
            options: [
              {
                value: '',
                label: t('editor.imageText.fitDefaultType', 'Default · {fit}', {
                  fit: typeFitLabel,
                }),
                title: t(
                  'editor.imageText.fitDefaultTypeTitle',
                  'Follow the slide type default'
                ),
              },
              { value: 'cover', label: t('editor.imageText.fitCover', 'Fill (crop)') },
              { value: 'contain', label: t('editor.imageText.fitContain', 'Fit (no crop)') },
            ],
          },
          typeof image.fit === 'string' ? image.fit : '',
          (v) => {
            images[idx].fit = v;
            markDirty?.();
            // The focus control below switches between grid (cover) and
            // alignment (contain) with the effective fit.
            rerenderEditor?.();
            scheduleUiRefresh?.();
          }
        )
      : null;
  const row = fieldGrid?.([altEl, fitEl].filter(Boolean), 2);
  if (row) card.append(row);

  // Focus control, consistent with the shared image-element card: a cover
  // (cropping) cell gets the 3x3 grid as the precise, keyboard-reachable
  // fallback to the canvas focal-point drag (both write the item's focusX/Y);
  // a contain cell gets its alignment control instead. Effective fit comes
  // from resolveImageTextCell (the single authority render/canvas share).
  const effFit = resolveImageTextCell(content, idx).fit;
  if (effFit === 'contain') {
    const posEl = renderImagePositionPicker({
      h,
      mode: 'contain',
      imageUrl: image.src,
      containerSelector:
        '.preview-panel .thumb.is-clickable-preview .slide-image-text .frame.is-fit-contain',
      focusX: image.focusX,
      focusY: image.focusY,
      onChange: ({ focusX, focusY }) => {
        images[idx].focusX = focusX;
        images[idx].focusY = focusY;
        markDirty?.();
        scheduleUiRefresh?.();
      },
    });
    if (posEl) card.append(posEl);
  } else {
    card.append(
      renderFocusGridField({
        h,
        label: t('editor.imageText.imageFocus', 'Image focus (crop)'),
        helpText: t(
          'editor.image.focusGridHelp',
          'Drag the point on the image, or pick a position here.'
        ),
        focusX: image.focusX,
        focusY: image.focusY,
        onChange: ({ focusX, focusY }) => {
          images[idx].focusX = focusX;
          images[idx].focusY = focusY;
          markDirty?.();
          scheduleUiRefresh?.();
        },
      })
    );
  }
}

/**
 * "This image" card for ONE selected cell (inspector element tab): picker,
 * alt, fit and focus for images[idx], flat (no collapsible, no header, no
 * collection controls). Returns null for an index outside the active
 * layout's cell range.
 *
 * @param {Object} opts - h, slide, used, idx + field renderers and edit hooks
 * @returns {HTMLElement|null}
 */
export function renderImageTextCellCard({
  h,
  slide,
  used,
  idx,
  fieldGrid,
  fieldText,
  fieldEnum,
  fieldImage,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  const content = prepareContent(slide, used);
  if (!content) return null;
  const cellCount = imageTextCellCount(content);
  if (!Number.isInteger(idx) || idx < 0 || idx >= cellCount) return null;

  const card = h('div', { class: 'stack' });
  appendCellControls({
    h, card, slide, content, idx,
    fieldGrid, fieldText, fieldEnum, fieldImage,
    markDirty, rerenderEditor, scheduleUiRefresh,
  });
  return card;
}

/**
 * Reorder/add/remove wiring shared by the slim collection section and the
 * full bulk-modal manager.
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
  const content = prepareContent(slide, used);
  if (!content) return null;

  const images = content.images;
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

/**
 * Full images manager (bulk "Edit all text" modal): the collection controls
 * AND every cell's settings in one list. The inspector no longer renders
 * this — it splits the same pieces over the Slide tab (collection) and the
 * element tab (per-cell settings).
 *
 * @param {Object} opts - h, slide, used + field renderers and edit hooks
 * @returns {HTMLElement|null}
 */
export function renderImageTextImagesSection({
  h,
  slide,
  used,
  fieldGrid,
  fieldText,
  fieldEnum,
  fieldImage,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  const content = prepareContent(slide, used);
  if (!content) return null;

  const images = content.images;
  const layout = String(content.layout || 'split');
  const isRow = layout === 'row-top' || layout === 'row-bottom';
  const cellCount = imageTextCellCount(content);
  const canAdd = isRow && images.length < IMAGE_TEXT_MAX_IMAGES;

  const actions = collectionActions({ content, markDirty, rerenderEditor, scheduleUiRefresh });

  const wrap = h('div', { class: 'stack' });
  const headerRow = h('div', { class: 'row is-between' });
  headerRow.append(
    h('div', {
      class: 'field-label',
      text:
        cellCount > 1
          ? t('editor.imageText.images', 'Images')
          : t('editor.imageText.image', 'Image'),
    })
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
    const card = h('div', { class: 'stack card-group' });

    if (cellCount > 1) {
      const head = h('div', { class: 'row spread card-group-header' });
      head.append(
        h('div', {
          class: 'card-group-title',
          text: t('editor.imageText.imageN', 'Image {n}', { n: i + 1 }),
        })
      );
      const controls = cellControlButtons({ h, content, i, cellCount, isRow, actions });
      if (controls) head.append(controls);
      card.append(head);
    }

    appendCellControls({
      h, card, slide, content, idx: i,
      fieldGrid, fieldText, fieldEnum, fieldImage,
      markDirty, rerenderEditor, scheduleUiRefresh,
    });

    wrap.append(card);
  }

  return wrap;
}
