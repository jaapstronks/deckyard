/**
 * Browser plumbing for the capture runner. Reuses the app's own
 * getPuppeteerBrowser() so we depend on the same system Chrome/Chromium the PDF
 * and PNG exporters already use — no extra browser download, no new dependency.
 */

import { getPuppeteerBrowser } from '../../server/utils/puppeteer-browser.js';

/** @typedef {{ width: number, height: number, deviceScaleFactor?: number }} Viewport */

/** Default capture viewport — the fixed convention for stable re-captures. */
export const DEFAULT_VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

/**
 * Open a fresh page with the given viewport. The caller closes it.
 * @param {Viewport} viewport
 * @returns {Promise<import('puppeteer-core').Page>}
 */
export async function openPage(viewport = DEFAULT_VIEWPORT) {
  const browser = await getPuppeteerBrowser({ featureName: 'Screenshot capture' });
  const page = await browser.newPage();
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor ?? 2,
  });
  // Force light-scheme rendering unless a recipe overrides it, so captures are
  // stable regardless of the host OS appearance.
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  return page;
}

/**
 * Navigate to an app URL. We wait only for `domcontentloaded`, not network
 * idle: the editor holds a long-lived SSE connection open, so the network never
 * goes idle and `networkidle0` would always time out. The real readiness signal
 * is the recipe's `waitFor` selector, applied by the runner after this.
 * @param {import('puppeteer-core').Page} page
 * @param {string} url
 */
export async function gotoStable(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
}

/**
 * Close the shared browser so the Node process can exit. getPuppeteerBrowser()
 * caches a single long-lived browser (for the server), so nothing closes it for
 * a one-shot CLI — without this the runner hangs after the last capture.
 */
export async function closeBrowser() {
  try {
    const browser = await getPuppeteerBrowser({ featureName: 'Screenshot capture' });
    await browser.close();
  } catch {
    // already gone — ignore
  }
}

/**
 * Give the page a beat for fonts + late layout to settle before the shot.
 * @param {import('puppeteer-core').Page} page
 */
export async function settle(page) {
  try {
    await page.evaluate(() => document.fonts?.ready);
  } catch {
    // document.fonts unavailable — ignore
  }
  // A short, fixed idle: enough for transitions/reflow, still deterministic.
  await new Promise((r) => setTimeout(r, 400));
}
