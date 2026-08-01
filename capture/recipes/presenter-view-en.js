/**
 * Recipe: the presenter's own screen — stage, timer, next slide and speaker notes (en).
 * Registry id: shot-presenter-view-en → public/images/marketing/presenter-view-en.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_features-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { presenterViewShot } from './_features-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default presenterViewShot('en');
