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
    cards: { field: 'rows', container: '.md-table-wrap', itemSelector: '.md-table tr' },
    // rows stays: column add/remove only exists in the form's grid editor.
    formText: ['title', 'caption'],
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = ['headerRow', 'tableStyle', 'animateByCell', 'cornerCell'];
