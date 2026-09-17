/**
 * A capture page is a window, not a fullscreen view (B323).
 *
 * Headless Chrome reports an 800×600 screen whatever the viewport, and the
 * presenter treats a viewport that fills the screen as fullscreen
 * (`client/views/presenter/fullscreen.js`). Together that shot every presenter
 * capture in the fullscreen layout, console hidden, and presenter-view-{en,nl}
 * failed on the timer toggle. `openPage()` now emulates a screen that holds
 * the viewport; this test runs the presenter's own fullscreen controller in
 * such a page and expects it to say "windowed".
 *
 * Requires a Chrome/Chromium binary: skips locally without one, fails in CI
 * (same rule as tests/export-chrome-smoke.test.js).
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { resolveChromeExecutablePath } from '../server/utils/puppeteer-browser.js';
import { openPage, closeBrowser } from '../capture/lib/browser.js';
import { createPresenterFullscreenController } from '../client/views/presenter/fullscreen.js';

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

after(() => closeBrowser());

test(
  'a capture viewport larger than 800×600 is not read as fullscreen',
  { skip },
  async () => {
    const page = await openPage({
      width: 1760,
      height: 1100,
      deviceScaleFactor: 1,
    });
    try {
      await page.goto('data:text/html,<!doctype html><title>screen</title>');
      const seen = await page.evaluate((source) => {
        const create = new Function(`return (${source})`)();
        const detach = create().attach();
        const state = {
          screen: [screen.width, screen.height],
          inner: [innerWidth, innerHeight],
          fullscreen:
            document.documentElement.classList.contains('is-fullscreen'),
        };
        detach();
        return state;
      }, createPresenterFullscreenController.toString());

      assert.deepEqual(seen.inner, [1760, 1100]);
      assert.ok(
        seen.screen[0] >= seen.inner[0] && seen.screen[1] > seen.inner[1],
        `screen ${seen.screen.join('×')} should hold the window`,
      );
      assert.equal(seen.fullscreen, false);
    } finally {
      await page.close();
    }
  },
);
