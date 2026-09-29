/**
 * Recipe: a bar chart slide with its data editor open, so the CSV grid and the
 * live chart preview are both in the frame.
 * Registry id: shot-chart-slide-editor
 *   → public/images/screenshots/chart-slide-editor.png
 * Doc page: docs/slide-types/data.md § Chart Slide
 */

import { slideEditorShot } from './_slide-editor-shots.js';

export default slideEditorShot({
  id: 'chart-slide-editor',
  type: 'chart-slide',
  content: {
    headerAlign: 'left',
    title: 'Active teams per quarter',
    subheading: 'Last four quarters',
    bottomSubheading: '',
    chartType: 'bar',
    data: 'Quarter,Teams\nQ1,120\nQ2,165\nQ3,210\nQ4,260',
    xLabel: 'Quarter',
    yLabel: 'Teams',
    series1Label: '',
    series2Label: '',
    showLegend: 'yes',
    showValues: 'yes',
    pieLabelMode: '%',
    background: 'mist',
  },
  // The inspector only carries an "Edit data…" button; the CSV input the docs
  // page describes lives in the modal it opens.
  async action(page) {
    await page.click('.chart-data-edit-btn');
    await page.waitForSelector('.chart-data-grid', { visible: true });
    await page.waitForSelector('.chart-data-preview-thumb svg', {
      visible: true,
    });
  },
});
