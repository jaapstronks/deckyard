/**
 * process-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for process-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    itemGhosts: [
      { list: 'items', field: 'text', item: '.process-step', within: '.step-content', pos: 'append' },
    ],
    // Horizontal process appends steps to the right (like timeline); vertical
    // process stacks them downward, so the add button follows the direction.
    cards: {
      field: 'items',
      fieldAliases: ['steps'],
      container: '.process-container',
      itemSelector: '.process-step',
      addPlacement: (slide) =>
        slide?.content?.direction === 'vertical' ? 'bottom-center' : 'right-center',
    },
    formText: [...HEADER_TEXT, 'items', 'steps'],
  };
