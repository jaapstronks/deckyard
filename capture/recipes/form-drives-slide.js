/**
 * Take: **"a slide is a form"** — the first clip of the video factory.
 *
 * Typing in the Fields view of the canvas column; the slide preview at its
 * head follows, word by word. That is the whole claim, and it is the one thing a still
 * screenshot structurally cannot make: `editor-form-nl` photographs the form
 * and its preview together, but only motion shows that one drives the other.
 *
 * Built **on top of** `editorFormShot('nl')` rather than beside it: the state,
 * route, readiness selector and the click that opens the Fields tab are taken
 * from the shot by reference, so the take and the marketing shot cannot drift
 * into photographing two different screens. It also means `hashRecipeGraph()`
 * already covers this take — `_marketing-shots.js` is in its module graph.
 *
 * Two labelled steps, so the camera is a move rather than a single push-in:
 * the first zooms to the field being typed into, the second follows the
 * pointer to the headline it changed. Both coordinates come from
 * `boundingBox()` at record time, so a restyled view moves the camera with it
 * instead of leaving it framing empty space.
 */

import { VIDEO_VIEWPORT } from '../lib/record.js';
import { editorFormShot } from './_marketing-shots.js';

/**
 * The shot this take is layered on. Only the fields that describe *how to
 * reach the state* are reused; `output`/`registryPath`/`fullPage` describe a
 * PNG in the website registry and have no meaning for a take.
 */
const shot = editorFormShot('nl');

/**
 * The title field in the Fields view, by its collaboration field key. It sits
 * in the view's head beside the preview, not inside `.editor-form`.
 */
const TITLE_FIELD = '.fields-view [data-collab-field-key="title"] .form-input';

/** The headline of the live preview at the head of the Fields view. */
const PREVIEW_HEADLINE = '.fields-view-preview .slide .heading';

/**
 * What gets typed. Short enough to land inside the beat, and different enough
 * from the seeded title that the slide visibly changes rather than re-rendering
 * the same words.
 */
const NEW_TITLE = 'Van kraam tot vaste klant';

/** @type {import('../lib/recipe.js').VideoRecipe} */
export default {
  id: 'form-drives-slide',
  kind: 'video',
  viewport: VIDEO_VIEWPORT,

  localStorage: shot.localStorage,
  state: shot.state,
  navigate: shot.navigate,
  waitFor: shot.waitFor,
  action: shot.action,

  record: {
    fps: 30,
    /** @param {import('../lib/recipe.js').Recorder} rec */
    async sequence(rec) {
      // A breath before anything moves. Without it the clip opens mid-action
      // and the viewer never sees the starting state it is about to change.
      await rec.hold(500);
      await rec.type(TITLE_FIELD, NEW_TITLE, { clear: true, label: 'field' });
      await rec.hold(500);
      // The pointer travels to the headline it just rewrote. This is the beat
      // that makes the point — and it is a second zoom keyframe, so the camera
      // pans instead of sitting on the field while the payoff happens offscreen.
      await rec.move(PREVIEW_HEADLINE, { label: 'preview' });
      await rec.hold(900);
    },
  },
};
