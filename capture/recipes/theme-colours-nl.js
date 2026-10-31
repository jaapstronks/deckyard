/**
 * Take: a new theme taking a brand's colours (row 7, "Your brand, in JSON"), Dutch chrome.
 * Launch video, deckyard-planning `briefs/launch-video-script.md`.
 *
 * Body lives in `_launch-takes.js` so the `-nl` and `-en` halves of the pair
 * cannot drift apart; only the language differs.
 */

import { themeColoursTake } from './_launch-takes.js';

/** @type {import('../lib/recipe.js').VideoRecipe} */
export default themeColoursTake('nl');
