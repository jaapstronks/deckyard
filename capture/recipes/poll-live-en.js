/**
 * Recipe: the poll slide mid-presentation with a real, uneven result (en).
 * Registry id: shot-poll-live-en → public/images/marketing/poll-live-en.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_marketing-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { pollLiveShot } from './_marketing-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default pollLiveShot('en');
