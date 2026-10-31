/**
 * Take: the presenter console starting the talk, camera on the notes (row 11), Dutch chrome.
 * Launch video, deckyard-planning `briefs/launch-video-script.md`.
 *
 * Body lives in `_launch-takes.js` so the `-nl` and `-en` halves of the pair
 * cannot drift apart; only the language differs.
 */

import { presenterNotesTake } from './_launch-takes.js';

/** @type {import('../lib/recipe.js').VideoRecipe} */
export default presenterNotesTake('nl');
