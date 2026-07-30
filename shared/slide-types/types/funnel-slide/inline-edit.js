/**
 * funnel-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for funnel-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    itemGhosts: [
      { list: 'items', field: 'value', item: '.funnel-stage', within: '.stage-content', pos: 'append', chip: 'top-start' },
      { list: 'items', field: 'text', item: '.funnel-stage', pos: 'append' },
    ],
    cards: { field: 'items', fieldAliases: ['stages'], container: '.funnel-container', itemSelector: '.funnel-stage' },
    formText: [...HEADER_TEXT, 'items', 'stages'],
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = [];
