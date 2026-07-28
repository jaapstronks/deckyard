/**
 * timeline-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for timeline-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    // The item element is a full-height column; the visible card is
    // transform-positioned within it. Pin the description chip to the card
    // (chipAnchor) so "+ Description" lands just under the milestone card, not
    // at the column bottom near the slide edge.
    itemGhosts: [
      { list: 'items', field: 'text', item: '.timeline-item', within: '.timeline-card', chipAnchor: '.timeline-card', pos: 'append' },
    ],
    // A new item appends to the right of the horizontal timeline, so the add
    // button sits at the right insertion point (on the track line), not
    // bottom-center over the bottom-subheading.
    cards: {
      field: 'items',
      container: '.timeline-container',
      itemSelector: '.timeline-item',
      removeAnchor: '.timeline-card',
      addPlacement: 'right-center',
    },
    formText: [...HEADER_TEXT, 'items'],
  };
