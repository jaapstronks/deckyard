/**
 * Recipe: the fill-from-translation preview — named fields, source text, what the model returned (en).
 * Registry id: shot-ai-fills-fields-en → public/images/marketing/ai-fills-fields-en.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_features-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { aiFillsFieldsShot } from './_features-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default aiFillsFieldsShot('en');
