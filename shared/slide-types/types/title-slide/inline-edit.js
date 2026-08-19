/**
 * title-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for title-slide. */
export const inlineEdit = {
  ghosts: [
    {
      field: 'subheading',
      anchors: [{ sel: '.title', pos: 'after', chip: 'below-start' }],
    },
    {
      field: 'meta',
      anchors: [{ sel: '.tsu-content', pos: 'append', chip: 'bottom-start' }],
    },
  ],
  formText: ['title', 'subheading', 'meta'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * The title background is now the shared slideBgImage (rendered by the
 * Background section); the type's own bgImage/bgAlt were removed
 * (title-bg-unification). logoCorner is the only title-specific keep.
 * @type {string[]}
 */
export const inspectorKeeps = ['logoCorner'];
