/**
 * Recipe: the editor bulk-edit view on the funnel slide — named fields left, live preview right (en).
 * Registry id: shot-editor-form-en → public/images/marketing/editor-form-en.png
 * Shot list: deckyard-website planning/marketing-beeld.md
 *
 * Body lives in `_marketing-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { editorFormShot } from './_marketing-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default editorFormShot('en');
