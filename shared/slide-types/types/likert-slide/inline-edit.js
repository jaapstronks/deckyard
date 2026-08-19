/**
 * likert-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for likert-slide. */
export const inlineEdit = {
  ghosts: Array.from({ length: 10 }, (_, i) => ({
    field: `option${i + 1}`,
    group: 'options',
    anchors: [{ sel: '.likert-options', pos: 'append', chip: 'bottom-start' }],
  })),
  formText: [
    'question',
    ...Array.from({ length: 10 }, (_, i) => `option${i + 1}`),
  ],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = ['onClose', 'onCloseTarget'];
