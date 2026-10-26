/**
 * Film the current translation workspace requesting structured suggestions.
 * Setup is shared with the Dutch marketing screenshot; the labelled button
 * and preview steps keep the existing video composition contract.
 * No model is called and no suggestion is accepted.
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
  // in place and the translation workspace is open, with no suggestions yet.
  action: aiFillsFieldsSetup,

  record: {
    fps: 30,
    /** @param {import('../lib/recipe.js').Recorder} rec */
    async sequence(rec) {
      // Show the workspace before asking for suggestions.
      await rec.hold(700);
      await rec.move(AI_FILLS_FIELDS_SELECTORS.button, { label: 'button' });
      // Long enough that the button is a thing you read before it is pressed.
      await rec.hold(500);
      await rec.click(AI_FILLS_FIELDS_SELECTORS.button, { label: 'preview' });
      // The payoff: the workspace renders field suggestions. This hold is also
      // the clip's slack — the composition cuts to a whole number of bars, so
      // the last hold is scripted long and gets trimmed rather than the clip
      // running out of film.
      await rec.hold(2200);
    },
  },
};
