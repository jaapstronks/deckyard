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
import { resolveImageSlideImage } from '../../image-slide-image.js';

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
    // Flat single image: clicking the frame sets image + alt in-slide. Focus,
    // role, layout and zoom stay in the side form.
    media: {
      photoSelector: '.image[data-inline-photo], .image-placeholder[data-inline-photo]',
      imageField: 'image',
      altField: 'alt',
    },
    // Draggable focal point on the single image, but only in cover mode -
    // contain (no crop) has nothing to move, so the point stays hidden there.
    // Effective fit comes from resolveImageSlideImage (own `fit` -> legacy
    // `layout` -> type default), the single authority the render shares.
    focus: {
      xField: 'focusX',
      yField: 'focusY',
      cropMode: (slide) => resolveImageSlideImage(slide?.content).fit,
    },
    formText: [...HEADER_TEXT, 'caption'],
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `layout` is intentionally absent since datamodel step 3: the conflated enum
 * split into the ImageRef axes `fit` + `bleed` (rendered via
 * appendImageSlideFitControls, not the generic keeps loop). Since the
 * editing-surfaces tab split ALL of these render in the "This image" element
 * tab only — the single image is the element; the slide form carries just
 * Background/Accessibility.
 * @type {string[]}
 */
export const inspectorKeeps = ['imageRole', 'fit', 'bleed', 'zoomSteps', 'zoomLevel', 'zoomPositions'];
