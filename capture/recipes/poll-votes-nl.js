/**
 * Take: votes arriving on the presenter's stage (row 9, "The room follows along. And votes."), Dutch chrome.
 * Launch video, deckyard-planning `briefs/launch-video-script.md`.
 *
 * Body lives in `_launch-takes.js` so the `-nl` and `-en` halves of the pair
 * cannot drift apart; only the language differs.
 */

import { pollVotesTake } from './_launch-takes.js';

/** @type {import('../lib/recipe.js').VideoRecipe} */
export default pollVotesTake('nl');
