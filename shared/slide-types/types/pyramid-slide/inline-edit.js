/**
 * pyramid-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for pyramid-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    itemGhosts: [
      { list: 'levels', field: 'text', item: '.pyramid-level', within: '.level-content', pos: 'append' },
    ],
    cards: { field: 'levels', container: '.pyramid-container', itemSelector: '.pyramid-level' },
    formText: [...HEADER_TEXT, 'levels'],
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = [];
