/**
 * embed-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for embed-slide. */
export const inlineEdit = {
    ghosts: [{ field: 'title', anchors: [{ sel: '.slide-inner', pos: 'prepend', chip: 'top-start' }] }],
    formText: ['title'],
  };
