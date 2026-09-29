/**
 * Recipe: the editor on a process slide with four numbered steps.
 * Registry id: shot-process-slide-editor
 *   → public/images/screenshots/process-slide-editor.png
 * Doc page: docs/slide-types/cards.md § Process
 */

import { slideEditorShot } from './_slide-editor-shots.js';

export default slideEditorShot({
  id: 'process-slide-editor',
  type: 'process-slide',
  content: {
    title: 'From draft to launch',
    subheading: '',
    bottomSubheading: '',
    direction: 'horizontal',
    items: [
      { title: 'Draft', text: 'Outline the story' },
      { title: 'Review', text: 'Collect comments' },
      { title: 'Rehearse', text: 'Present to the team' },
      { title: 'Launch', text: 'Share the public link' },
    ],
    background: 'mist',
  },
});
