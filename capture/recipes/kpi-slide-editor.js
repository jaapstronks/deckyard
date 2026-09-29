/**
 * Recipe: the editor on a KPI slide with three metrics.
 * Registry id: shot-kpi-slide-editor
 *   → public/images/screenshots/kpi-slide-editor.png
 * Doc page: docs/slide-types/data.md § KPI Slide
 */

import { slideEditorShot } from './_slide-editor-shots.js';

export default slideEditorShot({
  id: 'kpi-slide-editor',
  type: 'kpi-metrics-slide',
  content: {
    headerAlign: 'left',
    title: 'This quarter in numbers',
    subheading: '',
    bottomSubheading: '',
    background: 'mist',
    accent: 'none',
    countUp: 'off',
    metrics: [
      { value: '1.2', unit: 'k', label: 'Active teams', note: '+18% vs Q2' },
      { value: '64', unit: '%', label: 'Decks presented live', note: '+6pp' },
      { value: '4.6', unit: '', label: 'Average rating', note: '+0.3' },
    ],
  },
});
