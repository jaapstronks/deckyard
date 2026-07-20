/**
 * Images manager for the image-text slide (layout catalogue phase 2).
 *
 * Renders one compact card per visible image cell: picker, alt text,
 * per-image fit (empty = follow the slide-level Image fit) and a focus grid.
 * Rows can add a third image (the row model: the number of images sets the
 * columns); duo/split/corner have a fixed cell count, so no add button
 * there. Items beyond the active layout's cell count are kept in content
 * (switching layouts remembers the images) but not shown here.
 *
 * Calling this also canonicalizes the content via ensureImageTextImages:
 * legacy flat `image` migrates into images[0] and every rendered cell gets a
 * live item behind it (the WYSIWYG media popover mutates `images[idx]`).
 */
import { renderImagePositionPicker } from '../image-position-picker.js';
import { renderFocusGridField } from '../focus-picker.js';
import { t } from '../../../../lib/ui-i18n.js';
import {
  IMAGE_TEXT_MAX_IMAGES,
  ensureImageTextImages,
  imageTextCellCount,
} from '../../../../../shared/slide-types/image-text-images.js';

/**
 * Build the images section element, or null without content.
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
  const content = slide?.content;
  if (!content || typeof content !== 'object') return null;
  ensureImageTextImages(content);
  used?.add('image');
  used?.add('images');
  used?.add('alt');

  const images = content.images;
  const layout = String(content.layout || 'split');
  const isRow = layout === 'row-top' || layout === 'row-bottom';
  const cellCount = imageTextCellCount(content);
  const canAdd = isRow && images.length < IMAGE_TEXT_MAX_IMAGES;

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
        onclick: () => {
          images.push({ src: '', alt: '' });
          markDirty?.();
          rerenderEditor?.();
          scheduleUiRefresh?.();
        },
      })
    );
  }
  wrap.append(headerRow);

  const swap = (a, b) => {
    if (a < 0 || b < 0 || a >= images.length || b >= images.length) return;
    const tmp = images[a];
    images[a] = images[b];
    images[b] = tmp;
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };

  for (let i = 0; i < cellCount; i += 1) {
    const image = images[i] || {};
    const card = h('div', { class: 'stack card-group' });

    if (cellCount > 1) {
      const head = h('div', { class: 'row spread card-group-header' });
      head.append(
        h('div', {
          class: 'card-group-title',
          text: t('editor.imageText.imageN', 'Image {n}', { n: i + 1 }),
        })
      );
      const controls = h('div', { class: 'row' });
      if (i > 0) {
        controls.append(
          h('button', {
            type: 'button',
            class: 'btn btn-secondary btn-icon',
            text: '↑',
            title: t('editor.gallery.dragToReorder', 'Reorder'),
            onclick: () => swap(i, i - 1),
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
            onclick: () => swap(i, i + 1),
          })
        );
      }
      // Rows above the minimum can drop an image entirely (fewer columns);
      // fixed-cell layouts clear per image via the canvas/media popover.
      if (isRow && images.length > 2) {
        controls.append(
          h('button', {
            type: 'button',
            class: 'btn btn-secondary btn-icon card-remove-btn',
            text: '×',
            title: t('editor.imageText.removeImage', 'Remove image'),
            'aria-label': t('editor.imageText.removeImageN', 'Remove image {n}', { n: i + 1 }),
            onclick: () => {
              images.splice(i, 1);
              ensureImageTextImages(content);
              markDirty?.();
              rerenderEditor?.();
              scheduleUiRefresh?.();
            },
          })
        );
      }
      if (controls.childNodes.length) head.append(controls);
      card.append(head);
    }

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
            images[i].src = url;
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
      i === 0 && typeof content.alt === 'string' ? content.alt.trim() : '';
    const altEl =
      typeof fieldText === 'function'
        ? fieldText(
            t('editor.imageText.altText', 'Alt text'),
            typeof image.alt === 'string' ? image.alt : '',
            (v) => {
              images[i].alt = v;
              markDirty?.();
              scheduleUiRefresh?.();
            },
            slideAltFallback ? { placeholder: slideAltFallback } : {}
          )
        : null;
    const fitEl =
      typeof fieldEnum === 'function'
        ? fieldEnum(
            {
              key: 'fit',
              label: t('editor.imageText.imageFit', 'Image fit'),
              options: [
                { value: '', label: t('editor.imageText.fitDefault', 'Match slide') },
                { value: 'cover', label: t('editor.imageText.fitCover', 'Fill (crop)') },
                { value: 'contain', label: t('editor.imageText.fitContain', 'Fit (no crop)') },
              ],
            },
            typeof image.fit === 'string' ? image.fit : '',
            (v) => {
              images[i].fit = v;
              markDirty?.();
              scheduleUiRefresh?.();
            }
          )
        : null;
    const row = fieldGrid?.([altEl, fitEl].filter(Boolean), 2);
    if (row) card.append(row);

    // Focus control, consistent with the shared image-element card: a cover
    // (cropping) cell gets the 3x3 grid as the precise, keyboard-reachable
    // fallback to the canvas focal-point drag (both write the item's focusX/Y);
    // a contain cell gets its alignment control instead. Effective fit = the
    // item's own fit, else the slide-level default.
    const effFit =
      typeof image.fit === 'string' && image.fit
        ? image.fit
        : content.imageFit || 'cover';
    if (effFit === 'contain') {
      const posEl = renderImagePositionPicker({
        h,
        mode: 'contain',
        imageUrl: image.src,
        containerSelector:
          '.preview-panel .thumb.is-clickable-preview .slide-image-text.is-image-contain .frame',
        focusX: image.focusX,
        focusY: image.focusY,
        onChange: ({ focusX, focusY }) => {
          images[i].focusX = focusX;
          images[i].focusY = focusY;
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
            images[i].focusX = focusX;
            images[i].focusY = focusY;
            markDirty?.();
            scheduleUiRefresh?.();
          },
        })
      );
    }

    wrap.append(card);
  }

  return wrap;
}
