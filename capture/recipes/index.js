/**
 * Recipe registry. Each recipe reproduces exactly one documentation screenshot.
 * Add a new screenshot by dropping a `<id>.js` module here and listing it below.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import editorFull from './editor-full.js';
import slideTypePickerNew from './slide-type-picker-new.js';
import themeEditorFull from './theme-editor-full.js';

/** @type {import('../lib/recipe.js').Recipe[]} */
export const RECIPES = [editorFull, slideTypePickerNew, themeEditorFull];

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
