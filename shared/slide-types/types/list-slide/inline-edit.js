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
  ghosts: [
    {
      field: 'subheading',
      anchor: '.heading',
      pos: 'after',
      chip: 'below-end',
    },
  ],
  // "+ Text" chip on any item that has a title but no single-line text yet.
  // The renderer omits the empty .item-text div, so this is the only
  // affordance for adding it inline.
  itemGhosts: [
    {
      list: 'items',
      field: 'text',
      item: '.lijst-item',
      within: '.lijst-item-body',
      pos: 'append',
    },
  ],
  cards: {
    field: 'items',
    container: '.lijst',
    itemSelector: '.lijst-item',
  },
  formText: ['title', 'subheading', 'items'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `asideVariant` / `asideText`: the aside inset (shared/slide-types/aside-field.js).
 * Its body is click-to-edit on the canvas once it exists, but only once — the
 * inspector is where an author picks the kind, and that choice is what makes
 * the text field appear at all.
 * @type {string[]}
 */
export const inspectorKeeps = [
  'variant',
  'layout',
  'density',
  'asideVariant',
  'asideText',
];
