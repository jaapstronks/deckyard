/**
 * gallery-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for gallery-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    itemGhosts: [
      { list: 'images', field: 'caption', item: '.gallery-item', pos: 'append', chip: 'bottom-start' },
    ],
    cards: { field: 'images', container: '.gallery-container', itemSelector: '.gallery-item' },
    // Clicking a gallery image opens the media popover (image + alt); caption is
    // inline-editable via the item ghost above.
    media: {
      list: 'images',
      photoSelector: '.gallery-image[data-inline-photo], .gallery-image-placeholder[data-inline-photo]',
      imageField: 'src',
      altField: 'alt',
    },
    // Focal point per gallery image. Gallery tiles always crop (cover), so the
    // handle is always available on a filled image.
    focus: {
      xField: 'focusX',
      yField: 'focusY',
      cropMode: () => 'cover',
    },
    // images stays: the per-image cards also carry focus-point controls.
    formText: HEADER_TEXT,
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * Gallery keeps its layout enum: it was missing from the phase-3 audit's keeps
 * column, and enums are inspector material by definition.
 * @type {string[]}
 */
export const inspectorKeeps = ['layout'];
