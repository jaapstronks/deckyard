/**
 * Take: an open review thread being resolved (row 10, "Review without the email thread"), English chrome.
 * Launch video, deckyard-planning `briefs/launch-video-script.md`.
 *
 * Body lives in `_launch-takes.js` so the `-nl` and `-en` halves of the pair
 * cannot drift apart; only the language differs.
 */

import { commentResolveTake } from './_launch-takes.js';

/** @type {import('../lib/recipe.js').VideoRecipe} */
export default commentResolveTake('en');
