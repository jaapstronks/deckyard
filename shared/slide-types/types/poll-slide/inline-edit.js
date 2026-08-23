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
  // Since schema v9 the answers are one `options[]` array, so add/remove is the
  // generic card affordance driven by minItems/maxItems — not the four grouped
  // ghost chips the flat `option1..4` slots needed.
  cards: {
    field: 'options',
    container: '.poll-options',
    itemSelector: '.poll-option',
    addLabelKey: 'editor.inline.addAnswer',
    addLabel: 'Add answer',
    removeLabelKey: 'editor.inline.removeAnswer',
    removeLabel: 'Remove answer',
  },
  formText: ['question', 'options'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * `onCloseTarget`: companion of the kept onClose enum — was bulk-only.
 * @type {string[]}
 */
export const inspectorKeeps = ['onClose', 'onCloseTarget'];
