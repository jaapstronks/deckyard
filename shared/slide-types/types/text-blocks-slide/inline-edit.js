/**
 * text-blocks-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for text-blocks-slide. */
export const inlineEdit = {
    ghosts: HEADER_GHOSTS,
    // Row titles render for rows 2+ only (row 1 never has one); the ghost chip
    // sits at the row's top-left, where the spawned <h3> will appear.
    itemGhosts: [
      { list: 'rows', field: 'title', item: '.text-blocks-row', minIndex: 1, chip: 'top-start' },
    ],
    // Two-level cards: rows in the slide, blocks within each row. Rows append
    // at the bottom; blocks append to the right inside their row. The row's
    // remove × sits at its bottom-right corner because the top-right corner
    // coincides with the last block's own ×. skipWhenEmpty keeps legacy
    // numbered decks (no rows[]) free of affordances - the renderer reads the
    // numbered fields there, so writing rows[] would switch its data source.
    cards: {
      field: 'rows',
      skipWhenEmpty: true,
      container: '.text-blocks-content',
      itemSelector: '.text-blocks-row',
      removePlacement: 'bottom-right',
      // The row's top-left corner coincides with the first block's own grip,
      // so the row grip mirrors the row × on the bottom edge instead.
      reorderPlacement: 'bottom-left',
      addLabelKey: 'editor.inline.addRow',
      addLabel: 'Add row',
      removeLabelKey: 'editor.inline.removeRow',
      removeLabel: 'Remove row',
      child: {
        field: 'blocks',
        itemSelector: '.text-block',
        addPlacement: 'right-center',
        addLabelKey: 'editor.inline.addBlock',
        addLabel: 'Add block',
        removeLabelKey: 'editor.inline.removeBlock',
        removeLabel: 'Remove block',
        // A block whose title/body was cleared re-gains it via these chips
        // (the renderer omits the empty elements entirely).
        ghosts: [
          { field: 'title', chip: 'top-start' },
          { field: 'body', chip: 'bottom-start' },
        ],
      },
    },
    formText: HEADER_TEXT,
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = [];
