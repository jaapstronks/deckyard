/* global document, requestAnimationFrame */ // page.evaluate() callbacks run in the browser context.

import { debugLog } from './debug-log.js';

/**
 * Let a headless render finish laying itself out before it is captured.
 *
 * A document handed to `page.setContent()` is not done when `load` fires:
 * webfonts may still be swapping in, an image may not have decoded, and the
 * slide runtimes the script chain inlined (the Prism/KaTeX sweep, the
 * team-cards justify pass) react to those and write their result on the next
 * animation frame. A screenshot or `page.pdf()` taken before that captures the
 * CSS fallback instead of what the editor shows.
 *
 * One helper for every headless capture, so a path cannot quietly skip a step.
 * Each step is best-effort: a render that cannot wait still captures.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {Object} [options]
 * @param {number} [options.imageTimeoutMs=5000] - Per-image load cap.
 * @returns {Promise<void>}
 */
export async function settleRenderedPage(page, { imageTimeoutMs = 5000 } = {}) {
  try {
    await page.evaluate(() => document.fonts?.ready);
  } catch (err) {
    debugLog(
      '[settle-rendered-page] fonts did not settle:',
      err?.message || err,
    );
  }
  try {
    await page.evaluate(
      (timeoutMs) =>
        Promise.all(
          Array.from(document.querySelectorAll('img')).map((img) => {
            if (img.complete) return undefined;
            return new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
              setTimeout(resolve, timeoutMs);
            });
          }),
        ),
      imageTimeoutMs,
    );
  } catch (err) {
    debugLog(
      '[settle-rendered-page] images did not settle:',
      err?.message || err,
    );
  }
  // Two frames: the runtimes' load listeners schedule on the next frame, and
  // the one after it paints their result. The short timeout is for the scripts
  // (KaTeX) that render off a timer rather than a frame.
  try {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(resolve, 100)),
          );
        }),
    );
  } catch (err) {
    debugLog(
      '[settle-rendered-page] animation frames did not run:',
      err?.message || err,
    );
  }
}
