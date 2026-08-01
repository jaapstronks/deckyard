/**
 * Recipe: the share dialog's Link tab — a private link with a password and an expiry (nl).
 * Registry id: shot-share-link-rules-nl → public/images/marketing/share-link-rules-nl.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_features-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { shareLinkRulesShot } from './_features-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default shareLinkRulesShot('nl');
