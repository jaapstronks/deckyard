/**
 * Recipe: Import an existing deck on the PowerPoint or PDF subtab.
 * Registry id: shot-new-upload-file-dialog
 *   → public/images/screenshots/new-upload-file-dialog.png
 * Doc page: docs/creating/from-pptx.md
 */

import {
  seedCreationView,
  showCreationMethod,
} from './_creation-view-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'new-upload-file-dialog',
  output: 'new-upload-file-dialog.png',
  registryPath: 'public/images/screenshots/new-upload-file-dialog.png',
  fullPage: false,
  state: seedCreationView,
  navigate: '/',
  waitFor: '.sidebar-new-btn',
  action: (page) => showCreationMethod(page, 'import'),
};
