/**
 * comparison-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for comparison-slide. */
export const inlineEdit = {
    ghosts: [
      ...HEADER_GHOSTS,
      { field: 'leftTitle', anchors: [{ sel: '.comparison-side.left', pos: 'prepend', chip: 'top-start' }] },
      { field: 'leftBody', anchors: [{ sel: '.comparison-side.left', pos: 'append', chip: 'bottom-start' }] },
      { field: 'rightTitle', anchors: [{ sel: '.comparison-side.right', pos: 'prepend', chip: 'top-start' }] },
      { field: 'rightBody', anchors: [{ sel: '.comparison-side.right', pos: 'append', chip: 'bottom-start' }] },
      { field: 'verdict', anchors: [{ sel: '.comparison-split', pos: 'after', chip: 'below-start' }] },
    ],
    formText: [...HEADER_TEXT, 'leftTitle', 'leftBody', 'rightTitle', 'rightBody', 'verdict'],
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = [];
