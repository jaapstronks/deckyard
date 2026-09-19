/**
 * A capture page has a mouse (B351).
 *
 * Headless Chrome on a Linux host reports `(hover: none)`, and the editor then
 * draws its touch affordances into every shot: dashed outlines round each
 * field, "+" chips over the numbers. `openPage()` launches Chrome headful on a
 * private Xvfb there and refuses a page without hover; this test pins that the
 * page it hands out reports a mouse, on whatever host runs the suite — CI is
 * Linux, so it exercises the Xvfb path on every push.
 *
 * Requires a Chrome/Chromium binary: skips locally without one, fails in CI
 * (same rule as tests/export-chrome-smoke.test.js).
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { resolveChromeExecutablePath } from '../server/utils/puppeteer-browser.js';
import { openPage, closeBrowser } from '../capture/lib/browser.js';

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

after(() => closeBrowser());

for (const forRecording of [false, true]) {
  test(
    `a ${forRecording ? 'recording' : 'screenshot'} page reports hover and a fine pointer`,
    { skip },
    async () => {
      const page = await openPage(
        { width: 640, height: 360, deviceScaleFactor: 1 },
        { forRecording },
      );
      try {
        const media = await page.evaluate(() => ({
          hover: matchMedia('(hover: hover)').matches,
          fine: matchMedia('(pointer: fine)').matches,
        }));
        assert.deepEqual(media, { hover: true, fine: true });
      } finally {
        await page.close();
      }
    },
  );
}
