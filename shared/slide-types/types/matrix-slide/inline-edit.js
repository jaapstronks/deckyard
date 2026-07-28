/**
 * matrix-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for matrix-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    // cells are fixed 4/4 (min == max), so no add/remove buttons render; the
    // cards entry only provides item indexing for future use.
    cards: { field: 'cells', container: '.matrix-grid', itemSelector: '.matrix-cell' },
    formText: [...HEADER_TEXT, 'cells'],
  };
