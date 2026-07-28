/**
 * Recipe: the follow-along invite on the big screen — QR, short URL, access code (nl).
 * Registry id: shot-join-screen-nl → public/images/marketing/join-screen-nl.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_marketing-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { joinScreenShot } from './_marketing-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default joinScreenShot('nl');
