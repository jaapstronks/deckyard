/**
 * Recipe registry. Each recipe reproduces exactly one documentation screenshot.
 * Add a new screenshot by dropping a `<id>.js` module here and listing it below.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import editorFull from './editor-full.js';
import slideTypePickerNew from './slide-type-picker-new.js';
import themeEditorFull from './theme-editor-full.js';

// Marketing shots — deckyard-website public/images/marketing/, one pair per
// shot. See capture/README.md § Marketing shots for how they differ from the
// docs screenshots above (viewport, pinned theme, UI locale, live session).
import editorFormNl from './editor-form-nl.js';
import editorFormEn from './editor-form-en.js';
import pollLiveNl from './poll-live-nl.js';
import pollLiveEn from './poll-live-en.js';
import joinScreenNl from './join-screen-nl.js';
import joinScreenEn from './join-screen-en.js';

/** @type {import('../lib/recipe.js').Recipe[]} */
export const RECIPES = [
  editorFull,
  slideTypePickerNew,
  themeEditorFull,
  editorFormNl,
  editorFormEn,
  pollLiveNl,
  pollLiveEn,
  joinScreenNl,
  joinScreenEn,
];

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute filesystem path of a recipe module, used to hash its source so the
 * registry can detect when the recipe itself has drifted.
 * @param {string} id
 * @returns {string}
 */
export function recipeFsPath(id) {
  return path.join(HERE, `${id}.js`);
}
