/**
 * Take: the editor moving through the deck (row 5, "Presentations on your own server"), Dutch chrome.
 * Launch video, deckyard-planning `briefs/launch-video-script.md`.
 *
 * Body lives in `_launch-takes.js` so the `-nl` and `-en` halves of the pair
 * cannot drift apart; only the language differs.
 */

import { editorTourTake } from './_launch-takes.js';

/** @type {import('../lib/recipe.js').VideoRecipe} */
export default editorTourTake('nl');
