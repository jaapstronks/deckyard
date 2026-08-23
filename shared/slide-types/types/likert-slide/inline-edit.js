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
  // Since schema v9 the scale is one `options[]` array, so add/remove is the
  // generic card affordance driven by minItems/maxItems — not the ten grouped
  // ghost chips the flat `option1..10` slots needed.
  cards: {
    field: 'options',
    container: '.likert-options',
    itemSelector: '.likert-option',
    addLabelKey: 'editor.inline.addScaleLabel',
    addLabel: 'Add label',
    removeLabelKey: 'editor.inline.removeScaleLabel',
    removeLabel: 'Remove label',
  },
  formText: ['question', 'options'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = ['onClose', 'onCloseTarget'];
