/**
 * Recipe: the editor on a Likert slide with a five-point agreement scale.
 * Registry id: shot-likert-slide-editor
 *   → public/images/screenshots/likert-slide-editor.png
 * Doc page: docs/slide-types/interactive.md
 */

import { slideEditorShot } from './_slide-editor-shots.js';

export default slideEditorShot({
  id: 'likert-slide-editor',
  type: 'likert-slide',
  content: {
    question: 'The new review process saves us time.',
    options: [
      { text: 'Strongly disagree' },
      { text: 'Disagree' },
      { text: 'Neutral' },
      { text: 'Agree' },
      { text: 'Strongly agree' },
    ],
    background: 'mist',
    onClose: 'stay',
    onCloseTarget: '',
  },
});
