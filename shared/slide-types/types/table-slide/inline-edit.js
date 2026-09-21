/**
 * table-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

/** @type {Object} InlineDescriptor for table-slide. */
export const inlineEdit = {
  ghosts: [
    { field: 'caption', anchors: [{ sel: '.md-table-wrap', pos: 'after' }] },
  ],
  // Every cell is editable (rows.N.cM); add/remove works on whole rows. Note
  // the header is rows[0] when the header row is enabled.
  cards: {
    field: 'rows',
    container: '.md-table-wrap',
    // Anchor the "+" to the table, not the wrap: the wrap is a flex box that
    // fills the whole slide body, so against it the button landed on the
    // bottom edge of the slide - measured at ~330px below a three-row table,
    // which is why a user reported the row could not be added at all (B394).
    addAnchor: '.md-table',
    addLabelKey: 'editor.inline.addRow',
    addLabel: 'Add row',
    removeLabelKey: 'editor.inline.removeRow',
    removeLabel: 'Remove row',
    itemSelector: '.md-table tr',
    // The other structural axis. Columns are not items - they are the sibling
    // count the `rows` field names in `columnCountKey` - so they need their
    // own affordance rather than a second cards level.
    columns: {
      addAnchor: '.md-table',
      addPlacement: 'right-outside',
      addLabelKey: 'editor.inline.addColumn',
      addLabel: 'Add column',
    },
  },
  // rows stays out of formText: the grid editor also carries column delete and
  // markdown import, which the inline layer does not cover.
  formText: ['title', 'caption'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = [
  'headerRow',
  'tableStyle',
  'animateByCell',
  'cornerCell',
];
