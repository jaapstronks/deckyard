/**
 * Take: **"your agent builds the deck"** — the second clip of the video
 * factory, and the one that proves the format generalises.
 *
 * The first take (`form-drives-slide`) is a typing clip: one field, one live
 * preview. This one is a *click* clip — "Fill slide…" in the AI box is
 * pressed and a modal fills itself in — so between the two the recorder's
 * whole vocabulary (`hold` / `move` / `click` / `type`) is exercised by
 * something that ships.
 *
 * Built **on top of** `aiFillsFieldsShot('nl')`, the same way the first take
 * is built on `editorFormShot('nl')`: state, route, readiness selector and the
 * translate stub come from the shot by reference, so the take and the
 * marketing shot cannot drift into photographing two different screens. What
 * the take does *not* reuse is the shot's clicks — those are the motion, and
 * the whole point is to film them happening rather than to arrive after them.
 * `aiFillsFieldsSetup()` is exactly the half that prepares.
 *
 * **No model is called here either.** `stubTranslateFields()` answers the
 * translate request with the deck's own other-language text (see
 * `_features-shots.js`), so the words that appear are true, deterministic and
 * free. A clip that claimed "your agent fills this in" and then waited on a
 * live model would be neither reproducible nor cheap.
 *
 * Two labelled steps, so the camera makes a move rather than one push-in: the
 * button in the inspector's AI box, then the preview it opens. The second is
 * overridden to stay wide in `deckyard-video`'s spec — a modal is the shot,
 * and zooming into a thing that just arrived at full size is fighting it.
 */

import { VIDEO_VIEWPORT } from '../lib/record.js';
import {
  AI_FILLS_FIELDS_SELECTORS,
  aiFillsFieldsSetup,
  aiFillsFieldsShot,
} from './_features-shots.js';

/**
 * The shot this take is layered on. Only the fields describing *how to reach
 * the state* are reused; `output` / `registryPath` / `clip` / `viewport`
 * describe one PNG in the website registry and have no meaning for a take.
 */
const shot = aiFillsFieldsShot('nl');

/** @type {import('../lib/recipe.js').VideoRecipe} */
export default {
  id: 'agent-fills-fields',
  kind: 'video',
  viewport: VIDEO_VIEWPORT,

  localStorage: shot.localStorage,
  state: shot.state,
  navigate: shot.navigate,
  waitFor: shot.waitFor,
  // The preparing half of the shot's action, and only that half: the stub is
  // in place and the editor has rendered, but nothing has been clicked yet.
  action: aiFillsFieldsSetup,

  record: {
    fps: 30,
    /** @param {import('../lib/recipe.js').Recorder} rec */
    async sequence(rec) {
      // A breath on the untouched editor. Without it the clip opens on a modal
      // already opening and the viewer never sees what it opened *from*.
      await rec.hold(700);
      await rec.move(AI_FILLS_FIELDS_SELECTORS.button, { label: 'button' });
      // Long enough that the button is a thing you read before it is pressed.
      await rec.hold(500);
      await rec.click(AI_FILLS_FIELDS_SELECTORS.button, { label: 'preview' });
      // The payoff: the modal renders the per-field preview. This hold is also
      // the clip's slack — the composition cuts to a whole number of bars, so
      // the last hold is scripted long and gets trimmed rather than the clip
      // running out of film.
      await rec.hold(2200);
    },
  },
};
