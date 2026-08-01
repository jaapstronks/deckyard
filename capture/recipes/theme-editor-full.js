/**
 * Recipe: the theme editor, open on a fresh theme.
 * Registry id: shot-theme-editor-full
 *   → public/images/screenshots/theme-editor-full.png
 * Doc page: docs/themes/editor.md
 *
 * The theme editor is not its own route — it is a component inside the Themes
 * tab of settings. We land on /settings#themes (the dev-bypass user is admin, so
 * the designer-gated tab is available) and click "Create Theme" to open it.
 * This is a tall, full-page capture.
 *
 * The recipe finds that button by its English label, so it pins the UI locale
 * rather than inheriting one. `?lang=` cannot do this — that sets the *deck*
 * language — and the account's `uiLocale` is sticky: whatever the previous
 * recipe in a `--all` run left behind is what this one would have started with.
 */

import { CAPTURE_ACCOUNT_NAME, setDisplayName, setUiLocale } from '../lib/api.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'theme-editor-full',
  output: 'theme-editor-full.png',
  registryPath: 'public/images/screenshots/theme-editor-full.png',
  fullPage: true,

  async state(api) {
    await setUiLocale(api, 'en');
    // Pinned for the same reason as the locale: both are account settings that
    // survive from one recipe to the next, so an unset name would leave the
    // dev bypass's "Dev" in the chrome of whichever shot ran first.
    await setDisplayName(api, CAPTURE_ACCOUNT_NAME);
    return {};
  },

  navigate: () => '/settings#themes',

  // The Themes tab is rendered; the "Create Theme" button lives in its header.
  waitFor: '.settings-view, .settings-page, main',

  async action(page) {
    // Click the "Create Theme" button (no stable test-id; match by text).
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some((b) =>
          /create theme/i.test(b.textContent || '')
        ),
      { timeout: 15_000 }
    );
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /create theme/i.test(b.textContent || '')
      );
      if (!btn) throw new Error('Create Theme button not found');
      btn.click();
    });
    // Editor is open once .theme-editor mounts.
    await page.waitForSelector('.theme-editor', { visible: true, timeout: 15_000 });
  },
};
