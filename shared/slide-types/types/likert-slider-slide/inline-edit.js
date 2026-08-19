/**
 * likert-slider-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for likert-slider-slide. */
export const inlineEdit = {
  ghosts: [
    {
      field: 'minLabel',
      anchors: [{ sel: '.likert-slider-label', pos: 'append' }],
    },
    {
      field: 'maxLabel',
      anchors: [{ sel: '.likert-slider-label.is-right', pos: 'append' }],
    },
  ],
  formText: ['question', 'minLabel', 'maxLabel'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = [];
