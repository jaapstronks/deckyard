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
 */

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'theme-editor-full',
  output: 'theme-editor-full.png',
  registryPath: 'public/images/screenshots/theme-editor-full.png',
  fullPage: true,

  navigate: () => '/settings?lang=en#themes',

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
