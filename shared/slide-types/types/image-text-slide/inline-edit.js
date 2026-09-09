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

import { resolveImageTextImage } from './image.js';

/** @type {Object} InlineDescriptor for image-text-slide. */
export const inlineEdit = {
  ghosts: [{ field: 'caption', anchor: '.frame', pos: 'append' }],
  // Flat single image (D100): clicking the frame sets image + alt in-slide.
  // The image IS the element, so the shared "This image" card (element tab)
  // carries its ImageRef axes; the role is slide-wide and renders via the
  // inspector's keeps loop.
  media: {
    photoSelector: '.frame [data-inline-photo]',
    imageField: 'image',
    altField: 'alt',
  },
  // Draggable focal point on the image, but only in cover mode - contain (no
  // crop) has nothing to move, so the point stays hidden there and the element
  // card offers the alignment picker instead (measured against
  // containSelector). Effective fit comes from resolveImageTextImage, the
  // single authority the render shares.
  focus: {
    xField: 'focusX',
    yField: 'focusY',
    cropMode: (slide) => resolveImageTextImage(slide?.content).fit,
    containSelector:
      '.preview-panel .thumb.is-clickable-preview .slide-image-text .frame.is-fit-contain',
  },
  // The canonical fit axis, declared here rather than as a form field because
  // it is a property of the image element: one declaration, read by the canvas
  // affordances and by the element card.
  fit: {
    field: 'fit',
    fallback: (slide) => resolveImageTextImage(slide?.content).fit,
  },
  formText: ['title', 'caption', 'body'],
  convert: {
    // × on the empty placeholder removes the reserved image area = become a
    // plain text slide (with an image set the placeholder doesn't render, so
    // removal stays a deliberate two-step).
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
 * "Layout" chip is its canonical control in the inspector. imageSide /
 * imageWidth stay as precise, distinctly-named sub-settings. `fit` is absent
 * because it is an ImageRef property of the image ELEMENT, declared on the
 * descriptor above and rendered by the shared "This image" card — listing it
 * here would render it a second time in the slide form.
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
  'imageSide',
  'imageWidth',
  'imageBackground',
  'actions',
  'asideVariant',
  'asideText',
];

/**
 * The one image lives at index 0 — there is no collection to walk.
 * Grammar: shared/slide-types/inline-edit-companions.js.
 * @type {Object}
 */
export const elementTab = { image: { range: [0, 0] } };
