/**
 * Recipe: the ordinary editor on the KPI slide — thumbnails, canvas and inspector, no modal (en).
 * Registry id: marketing-editor-canvas-en → public/images/marketing/editor-canvas-en.png
 * Source: _meta briefing 2026-09-18 editor-canvas-capture (B348)
 *
 * Body lives in `_marketing-shots.js` so the `-nl` and `-en` halves of the
 * pair cannot drift apart; only the language differs.
 */

import { editorCanvasShot } from './_marketing-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default editorCanvasShot('en');
