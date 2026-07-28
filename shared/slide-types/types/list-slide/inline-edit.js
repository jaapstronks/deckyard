/**
 * list-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for list-slide. */
export const inlineEdit = {
    ghosts: [{ field: 'subheading', anchor: '.heading', pos: 'after', chip: 'below-end' }],
    // "+ Text" chip on any item that has a title but no single-line text yet.
    // The renderer omits the empty .item-text div, so this is the only
    // affordance for adding it inline.
    itemGhosts: [
      { list: 'items', field: 'text', item: '.lijst-item', within: '.lijst-item-body', pos: 'append' },
    ],
    cards: {
      field: 'items',
      container: '.lijst',
      itemSelector: '.lijst-item',
    },
    formText: ['title', 'subheading', 'items'],
  };
