/**
 * Recipe: the presenter's own screen — stage, timer, next slide and speaker notes (nl).
 * Registry id: shot-presenter-view-nl → public/images/marketing/presenter-view-nl.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_features-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { presenterViewShot } from './_features-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default presenterViewShot('nl');
