/**
 * content-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for content-slide. */
export const inlineEdit = {
  ghosts: [
    {
      field: 'subheading',
      anchor: '.heading',
      pos: 'after',
      chip: 'below-end',
    },
  ],
  formText: ['title', 'subheading', 'body'],
  convert: {
    // "Add an image" on a text slide = become an image-text slide (empty
    // image); the existing placeholder + media popover take over from there.
    addMedia: {
      toType: 'image-text-slide',
      anchors: [{ sel: '.slide-inner', chip: 'bottom-start' }],
    },
  },
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `actions`: CTA buttons (label/url/style) have no canvas surface — config.
 * @type {string[]}
 */
export const inspectorKeeps = ['layout', 'density', 'actions'];
