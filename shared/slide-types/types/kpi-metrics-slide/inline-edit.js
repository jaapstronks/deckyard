/**
 * kpi-metrics-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_GHOSTS, HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for kpi-metrics-slide. */
export const inlineEdit = {
  ghosts: HEADER_GHOSTS,
  itemGhosts: [
    {
      list: 'metrics',
      field: 'unit',
      item: '.kpi-metric',
      within: '.kpi-value',
      pos: 'append',
    },
    // The note line under the label; the renderer omits it when empty.
    { list: 'metrics', field: 'note', item: '.kpi-metric', pos: 'append' },
  ],
  cards: {
    field: 'metrics',
    container: '.kpi-grid',
    itemSelector: '.kpi-metric',
  },
  // Every metric subfield (value, unit, label, note) edits on the canvas.
  formText: [...HEADER_TEXT, 'metrics'],
};

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 * @type {string[]}
 */
export const inspectorKeeps = ['accent', 'countUp'];
