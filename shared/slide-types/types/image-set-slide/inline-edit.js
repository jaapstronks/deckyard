/**
 * image-set-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { resolveImageSetCell, IMAGE_SET_IMAGE_DEFAULTS } from './images.js';

/** @type {Object} InlineDescriptor for image-set-slide. */
export const inlineEdit = {
  ghosts: [{ field: 'caption', anchor: '.frame', pos: 'append' }],
  // Every cell (filled <img> or empty placeholder) carries
  // data-inline-photo="<idx>"; clicking mutates images[idx] (src + alt) in
  // place. Per-image fit/focus and reordering stay in the images section.
  media: {
    list: 'images',
    photoSelector: '.frame [data-inline-photo]',
    imageField: 'src',
    altField: 'alt',
  },
  // Draggable focal point on each filled image (crop/cover mode only). Writes
  // the item's own focusX/focusY - the same keys the renderer reads - so a drag
  // localizes the crop to that cell.
  focus: {
    xField: 'focusX',
    yField: 'focusY',
    cropMode: (slide, idx) => resolveImageSetCell(slide?.content, idx).fit,
    get: (slide, idx) => {
      const { focusSource } = resolveImageSetCell(slide?.content, idx);
      return { x: focusSource.focusX, y: focusSource.focusY };
    },
    containSelector:
      '.preview-panel .thumb.is-clickable-preview .slide-image-set .frame.is-fit-contain',
  },
  // Cover/Contain toggle on each filled image. Writes the item's own `fit`; the
  // fallback seeds the initial state for an item without one, which is the type
  // default — the whole chain, since this type has no slide-level fit.
  fit: {
    field: 'fit',
    fallback: () => IMAGE_SET_IMAGE_DEFAULTS.fit,
  },
  formText: ['title', 'caption', 'body'],
  // No `convert.removeMedia`: a set always renders at least two cells, so there
  // is no "the ONLY empty placeholder" to click away. Dropping to a single
  // image is a type change, offered as the split-half layout tile instead.
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `layout` (structural variant) is intentionally NOT kept: the toolbar
 * "Layout" chip is its canonical control in the inspector. textColumns /
 * imageSide stay as precise, distinctly-named sub-settings. Fit is absent
 * because it is a per-image ImageRef property (images manager / "This image"),
 * never a slide-level setting.
 *
 * `asideVariant` / `asideText`: the aside inset (shared/slide-types/aside-field.js).
 * Its body is click-to-edit on the canvas once it exists, but only once — the
 * inspector is where an author picks the kind, and that choice is what makes
 * the text field appear at all.
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
  'asideVariant',
  'asideText',
];

/**
 * One tab per cell the type can render, 0..2: `images[]` is padded to the
 * minimum on demand, so a selection may point past the stored items, but never
 * past the three-image ceiling. A fixed window rather than `{ list: 'images' }`
 * for that first reason, and rather than `{ any: true }` for the second.
 * Grammar: shared/slide-types/inline-edit-companions.js.
 * @type {Object}
 */
export const elementTab = { image: { range: [0, 2] } };
