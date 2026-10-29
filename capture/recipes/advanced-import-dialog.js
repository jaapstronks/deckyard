/**
 * Recipe: the new-presentation dialog on its Import method, with the `.deck`
 * sub-tab and the install choice a designer gets. Since B829 the panel opens
 * on PowerPoint or PDF (that is `new-upload-file-dialog`), so this recipe picks
 * the `.deck` sub-tab itself (B882).
 * Registry id: shot-advanced-import-dialog
 *   → public/images/screenshots/advanced-import-dialog.png
 * Doc pages: docs/creating/from-json.md, docs/creating/from-markdown.md
 */

import {
  seedCreationView,
  showCreationMethod,
} from './_creation-view-shots.js';

/** Position of `.deck` in the import panel's sub-tabs (`import-compose.js`). */
const DECK_SUBTAB_INDEX = 1;

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'advanced-import-dialog',
  output: 'advanced-import-dialog.png',
  registryPath: 'public/images/screenshots/advanced-import-dialog.png',
  fullPage: false,
  state: seedCreationView,
  navigate: '/',
  waitFor: '.sidebar-new-btn',

  async action(page) {
    await showCreationMethod(page, 'import');
    const panel = '.creation-panel[data-method="import"]';
    await page.evaluate(
      (sel, index) => {
        document.querySelectorAll(`${sel} .sb-segmented-btn`)[index].click();
      },
      panel,
      DECK_SUBTAB_INDEX,
    );
    // The `.deck` file input is the one sign this sub-panel, and not the
    // PowerPoint/PDF one, is on screen.
    await page.waitForSelector(`${panel} input[type="file"][accept^=".deck"]`, {
      visible: true,
    });
  },
};
