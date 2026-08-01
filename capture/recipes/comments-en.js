/**
 * Recipe: the comments pane beside the preview, one thread open and one resolved (en).
 * Registry id: shot-comments-en → public/images/marketing/comments-en.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_features-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { commentsShot } from './_features-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default commentsShot('en');
