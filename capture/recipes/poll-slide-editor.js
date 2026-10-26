/** A real four-answer poll in the editor, without a live session. */
import { slideEditorShot } from './_slide-editor-shots.js';

export default slideEditorShot({
  id: 'poll-slide-editor',
  type: 'poll-slide',
  content: {
    question: 'What should we focus on next?',
    options: [
      { text: 'A simpler first experience' },
      { text: 'Better collaboration' },
      { text: 'Clearer insights' },
      { text: 'More integrations' },
    ],
    background: 'lime',
    onClose: 'stay',
  },
});
