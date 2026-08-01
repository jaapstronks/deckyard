/**
 * image-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_TEXT } from '../../inline-edit-common.js';
import { resolveImageSlideImage } from './image.js';

/** @type {Object} InlineDescriptor for image-slide. */
export const inlineEdit = {
    ghosts: [
      {
        field: 'title',
        anchors: [
          { sel: '.img-heading', pos: 'prepend', chip: 'top-start' },
          { sel: '.slide-inner', pos: 'prepend', chip: 'top-start' },
        ],
      },
      {
        field: 'subheading',
        anchors: [
          { sel: '.img-title', pos: 'after' },
          { sel: '.img-heading', pos: 'append' },
          { sel: '.slide-inner', pos: 'prepend', chip: 'top-start' },
        ],
      },
      { field: 'caption', anchors: [{ sel: '.frame', pos: 'append', chip: 'bottom-start' }] },
      { field: 'bottomSubheading', anchors: [{ sel: '.slide-inner', pos: 'append', chip: 'bottom-start' }] },
    ],
    // Flat single image: clicking the frame sets image + alt in-slide. The
    // image IS the element, so the shared "This image" card (element tab)
    // carries its ImageRef axes; role and zoom are slide-wide and render via
    // the inspector's keeps loop.
    media: {
      photoSelector: '.image[data-inline-photo], .image-placeholder[data-inline-photo]',
      imageField: 'image',
      altField: 'alt',
    },
    // Draggable focal point on the single image, but only in cover mode -
    // contain (no crop) has nothing to move, so the point stays hidden there
    // and the element card offers the alignment picker instead (measured
    // against containSelector).
    // Effective fit comes from resolveImageSlideImage (own `fit` -> legacy
    // `layout` -> type default), the single authority the render shares.
    focus: {
      xField: 'focusX',
      yField: 'focusY',
      cropMode: (slide) => resolveImageSlideImage(slide?.content).fit,
      containSelector:
        '.preview-panel .thumb.is-clickable-preview .slide-image.is-fit-contain .frame',
    },
    // The two canonical ImageRef axes (datamodel step 3, replacing the
    // conflated `layout` enum). Declared here rather than as form fields
    // because they are properties of the image element: one declaration, read
    // by the canvas affordances and by the element card.
    fit: {
      field: 'fit',
      fallback: (slide) => resolveImageSlideImage(slide?.content).fit,
    },
    bleed: { field: 'bleed' },
    formText: [...HEADER_TEXT, 'caption'],
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `layout` is intentionally absent since datamodel step 3: the conflated enum
 * split into the ImageRef axes `fit` + `bleed`. Those two are absent as well
 * since the editor-behaviour-abstraction step 5: they are ImageRef properties
 * of the image ELEMENT, declared on the descriptor above and rendered by the
 * shared "This image" card — listing them here would render them a second time
 * in the slide form.
 *
 * What is left is genuinely slide-wide: the a11y role of the one image, and
 * the zoom chain, which is presentation behaviour of the slide (the presenter
 * steps through its regions), not a property of the image.
 * @type {string[]}
 */
export const inspectorKeeps = ['imageRole', 'zoomSteps', 'zoomLevel', 'zoomPositions'];
