/**
 * image-text-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { resolveImageTextCell, IMAGE_TEXT_IMAGE_DEFAULTS } from './images.js';

/** @type {Object} InlineDescriptor for image-text-slide. */
export const inlineEdit = {
  ghosts: [{ field: 'caption', anchor: '.frame', pos: 'append' }],
  // images[] media (phase 2): every cell (filled <img> or empty
  // placeholder) carries data-inline-photo="<idx>"; clicking mutates
  // images[idx] (src + alt) in place. Legacy flat decks migrate to
  // images[] when the editor forms render (ensureImageTextImages); the
  // inline editor pads missing items up to the clicked cell. Per-image
  // fit/focus and reordering stay in the images section.
  media: {
    list: 'images',
    photoSelector: '.frame [data-inline-photo]',
    imageField: 'src',
    altField: 'alt',
  },
  // Draggable focal point on each filled image (crop/cover mode only). Writes
  // the item's own focusX/focusY (the same keys the renderer reads once an
  // item has its own focus), so a drag localizes the crop to that cell. Fit
  // is the item's `fit` (falling back to the type default via the resolver).
  focus: {
    xField: 'focusX',
    yField: 'focusY',
    // Effective fit and crop-point both come from resolveImageTextCell (the
    // single authority render shares), so the handle starts where the crop
    // actually is - cell 0 without its own focus reads the slide-level focus.
    // Writes always localize to the item, which then wins on the next render.
    cropMode: (slide, idx) => resolveImageTextCell(slide?.content, idx).fit,
    get: (slide, idx) => {
      const { focusSource } = resolveImageTextCell(slide?.content, idx);
      return { x: focusSource.focusX, y: focusSource.focusY };
    },
    containSelector:
      '.preview-panel .thumb.is-clickable-preview .slide-image-text .frame.is-fit-contain',
  },
  // Cover/Contain toggle on each filled image. Writes the item's own `fit`
  // (canonical since step 2b), so a toggle localizes to that cell. The
  // fallback seeds the initial state for an item without its own fit: the
  // legacy slide-level `imageFit` on an un-migrated deck, else the type
  // default - same chain as resolveImageTextCell.
  fit: {
    field: 'fit',
    fallback: (slide) =>
      slide?.content?.imageFit || IMAGE_TEXT_IMAGE_DEFAULTS.fit,
  },
  formText: ['title', 'caption', 'body'],
  convert: {
    // × on the ONLY empty placeholder removes the reserved image area =
    // become a plain text slide (with an image set the placeholder doesn't
    // render, so removal stays a deliberate two-step). Multi-cell layouts
    // (duo/rows) manage their cells in the images section instead - no
    // convert affordance per cell.
    removeMedia: {
      toType: 'content-slide',
      selector:
        '.media > .frame:only-child .image-placeholder.is-empty[data-inline-photo]',
    },
  },
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `layout` (structural variant) is intentionally NOT kept: the toolbar
 * "Layout" chip is its canonical control in the inspector. textColumns /
 * imageSide stay as precise, distinctly-named sub-settings. `imageFit` is
 * intentionally absent since datamodel step 2b: fit is a per-image ImageRef
 * property (images manager / "This image"), no longer a writable slide-level
 * setting.
 * @type {string[]}
 */
export const inspectorKeeps = [
  'imageRole',
  'density',
  'textColumns',
  'imageSide',
  'imageWidth',
  'imageBackground',
  'actions',
];
