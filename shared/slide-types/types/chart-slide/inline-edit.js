/**
 * chart-slide — inline-edit companion.
 *
 * What the editor lets someone change on this slide's canvas. Read by the
 * inline-edit aggregator (shared/slide-types/inline-edit.js) and, through it,
 * client/views/editor/inline-edit/descriptors.js. Never imported by this type's
 * `index.js`/`render.js` — see docs/reference/slide-type-directory.md.
 *
 * Descriptor grammar: client/views/editor/inline-edit/descriptors.js.
 */

import { HEADER_TEXT } from '../../inline-edit-common.js';

/** @type {Object} InlineDescriptor for chart-slide. */
export const inlineEdit = {
    // Clicking the chart area opens the markdown data editor (the renderer tags
    // `.chart-area` with data-inline-field="data"). Chart type / labels / legend
    // stay in the side form.
    ghosts: [
      { field: 'subheading', anchors: [{ sel: '.chart-title-row', pos: 'after' }] },
      { field: 'bottomSubheading', anchors: [{ sel: '.slide-inner', pos: 'append', chip: 'bottom-start' }] },
    ],
    // 'data' stays: the form's chart-data editor has type-aware extras.
    formText: HEADER_TEXT,
  };

/**
 * Fields the inspector keeps rendering even though the inline layer covers the
 * rest of the slide.
 *
 * Axis/series labels render on the chart but are not inline-editable — chart
 * config, were bulk-only (audit 2026-07-21). `data` is kept for its entry
 * point: the csv-grid widget renders an "Edit data…" button in the inspector
 * (the grid itself lives on the bottom-panel Data tab, editing-surfaces §4.3).
 * @type {string[]}
 */
export const inspectorKeeps = [
  'chartType',
  'data',
  'showLegend',
  'showValues',
  'pieLabelMode',
  'xLabel',
  'yLabel',
  'series1Label',
  'series2Label',
];
