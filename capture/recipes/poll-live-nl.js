/**
 * Recipe: the poll slide mid-presentation with a real, uneven result (nl).
 * Registry id: shot-poll-live-nl → public/images/marketing/poll-live-nl.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_marketing-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { pollLiveShot } from './_marketing-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default pollLiveShot('nl');
