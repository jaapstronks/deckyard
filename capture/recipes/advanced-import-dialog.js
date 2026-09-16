/**
 * Recipe: the new-presentation dialog on its Import method, with the `.deck`
 * sub-tab (the default) and the install choice a designer gets.
 * Registry id: shot-advanced-import-dialog
 *   → public/images/screenshots/advanced-import-dialog.png
 * Doc pages: docs/creating/from-json.md, docs/creating/from-markdown.md
 */

import {
  CAPTURE_ACCOUNT_NAME,
  setDisplayName,
  setUiLocale,
} from '../lib/api.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'advanced-import-dialog',
  output: 'advanced-import-dialog.png',
  registryPath: 'public/images/screenshots/advanced-import-dialog.png',
  fullPage: false,

  async state(api) {
    // `uiLocale` and the display name are sticky account settings; see
    // editor-full.js.
    await setUiLocale(api, 'en');
    await setDisplayName(api, CAPTURE_ACCOUNT_NAME);
    return {};
  },

  navigate: '/',

  waitFor: '.sidebar-new-btn',

  async action(page) {
    await page.click('.sidebar-new-btn');
    await page.waitForSelector('.creation-rail-item', { visible: true });
    // The Import method is the last rail item.
    const items = await page.$$('.creation-rail-item');
    await items[items.length - 1].click();
    await page.waitForSelector(
      '.creation-panel[data-method="import"]:not(.is-hidden)',
      { visible: true, timeout: 15_000 },
    );
  },
};
