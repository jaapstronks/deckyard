/**
 * Recipe: the comments pane beside the preview, one thread open and one resolved (nl).
 * Registry id: shot-comments-nl → public/images/marketing/comments-nl.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_features-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { commentsShot } from './_features-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default commentsShot('nl');
