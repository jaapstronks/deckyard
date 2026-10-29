/**
 * Recipe: the Follow-along invite slide selected in the editor, its own form
 * (explanation, the "use while presenting" switch, title and text) beside the
 * preview (B883).
 * Registry id: shot-follow-invite-slide
 *   → public/images/screenshots/follow-invite-slide.png
 * Doc page: docs/presenter/follow-mode.md
 *
 * The editor fetches the deck's join code for the preview, so the shot shows
 * a filled code and the /go address of the capture base, as presenting does.
 */
import { slideEditorShot } from './_slide-editor-shots.js';

export default slideEditorShot({
  id: 'follow-invite-slide',
  type: 'follow-invite-slide',
  content: { enabled: true },
});
