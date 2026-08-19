/**
 * poll-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for poll-slide. */
export const inlineEdit = {
  ghosts: [1, 2, 3, 4].map((n) => ({
    field: `option${n}`,
    group: 'options',
    anchors: [{ sel: '.poll-options', pos: 'append', chip: 'bottom-start' }],
  })),
  formText: ['question', 'option1', 'option2', 'option3', 'option4'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `onCloseTarget`: companion of the kept onClose enum — was bulk-only.
 * @type {string[]}
 */
export const inspectorKeeps = ['onClose', 'onCloseTarget'];
