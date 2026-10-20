/**
 * Recipe: the creation view on Blank, with language and theme choices.
 * Registry id: shot-new-presentation-dialog
 *   → public/images/screenshots/new-presentation-dialog.png
 * Doc pages: docs/creating/new-presentation.md, docs/creating/index.md
 */

import {
  seedCreationView,
  showCreationMethod,
} from './_creation-view-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'new-presentation-dialog',
  output: 'new-presentation-dialog.png',
  registryPath: 'public/images/screenshots/new-presentation-dialog.png',
  fullPage: false,
  state: seedCreationView,
  navigate: '/',
  waitFor: '.sidebar-new-btn',
  action: (page) => showCreationMethod(page, 'blank'),
};
