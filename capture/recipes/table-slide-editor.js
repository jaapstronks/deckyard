/**
 * Recipe: the editor on a table slide, with the style and corner-cell choices
 * in view.
 * Registry id: shot-table-slide-editor
 *   → public/images/screenshots/table-slide-editor.png
 * Doc page: docs/slide-types/data.md § Table Slide
 */

import { slideEditorShot } from './_slide-editor-shots.js';

export default slideEditorShot({
  id: 'table-slide-editor',
  type: 'table-slide',
  content: {
    title: 'Release plan',
    caption: 'Dates are targets, not promises',
    headerRow: 'on',
    animateByCell: 'off',
    colCount: '4',
    rows: [
      { c1: 'Milestone', c2: 'Owner', c3: 'Target', c4: 'Status' },
      { c1: 'Beta invite', c2: 'Product', c3: 'Week 2', c4: 'Done' },
      { c1: 'Docs refresh', c2: 'Content', c3: 'Week 4', c4: 'On track' },
      { c1: 'Public launch', c2: 'Marketing', c3: 'Week 6', c4: 'Planned' },
    ],
    tableStyle: 'panel',
    cornerCell: 'header',
    background: 'mist',
  },
});
