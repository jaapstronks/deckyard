/**
 * Recipe: Generate from content on the Paste text subtab.
 * Registry id: shot-new-from-content-dialog
 *   → public/images/screenshots/new-from-content-dialog.png
 * Doc pages: docs/creating/from-text.md, docs/creating/from-notion.md,
 *   docs/creating/from-pptx.md, docs/ai/getting-started.md
 */

import {
  seedCreationView,
  showCreationMethod,
} from './_creation-view-shots.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'new-from-content-dialog',
  output: 'new-from-content-dialog.png',
  registryPath: 'public/images/screenshots/new-from-content-dialog.png',
  fullPage: false,
  state: seedCreationView,
  navigate: '/',
  waitFor: '.sidebar-new-btn',
  action: (page) => showCreationMethod(page, 'content'),
};
