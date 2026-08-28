/**
 * Browser plumbing for the capture runner. Reuses the app's own
 * getPuppeteerBrowser() so we depend on the same system Chrome/Chromium the PDF
 * and PNG exporters already use — no extra browser download, no new dependency.
 */

import puppeteer from 'puppeteer-core';

import {
  getPuppeteerBrowser,
  resolveChromeExecutablePath,
} from '../../server/utils/puppeteer-browser.js';

/** @typedef {{ width: number, height: number, deviceScaleFactor?: number }} Viewport */

/** Default capture viewport — the fixed convention for stable re-captures. */
export const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
};

/**
 * A second browser, launched only for recordings, at a forced device scale.
 *
 * Why a screenshot and a recording cannot share one browser: `page.screenshot()`
 * honours the *emulated* `deviceScaleFactor`, but a screencast does not.
 * Puppeteer sizes the encoder from `#getNativePixelDimensions()`, which
 * measures with `deviceScaleFactor: 0` — the host's real pixel ratio, which is
 * 1 in headless Chrome. So an emulated 3× viewport records at 1×: a 1280×720
 * file where the master was supposed to be 3840×2160, silently, with no error
 * and a video that looks fine until you zoom into it.
 *
 * The fix is `--force-device-scale-factor`, and that is a *launch* flag: it
 * makes the ratio native rather than emulated, so the screencast sees it. It
 * cannot go on the shared browser — that one is the app's own export browser
 * (PDF, PNG), and forcing 3× there would triple every exported page.
 *
 * @type {{ scale: number, browser: Promise<import('puppeteer-core').Browser> } | null}
 */
let recordingBrowser = null;

/**
 * Browser to record in, launched at `scale` native device pixels per CSS pixel.
 *
 * One scale per process: a second scale would silently produce a differently
 * sized master in the same run, and "which take is 4K?" is not a question the
 * output should be able to raise.
 *
 * @param {number} scale
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function getRecordingBrowser(scale) {
  if (recordingBrowser && recordingBrowser.scale !== scale) {
    throw new Error(
      `Recording browser already launched at ${recordingBrowser.scale}×; ` +
        `cannot also record at ${scale}× in one run.`,
    );
  }
  if (!recordingBrowser) {
    recordingBrowser = {
      scale,
      browser: (async () => {
        const executablePath = await resolveChromeExecutablePath();
        if (!executablePath) {
          throw new Error(
            'Video capture needs a Chrome/Chromium executable. Install Chrome, ' +
              'or set PUPPETEER_EXECUTABLE_PATH to the browser binary.',
          );
        }
        return puppeteer.launch({
          headless: true,
          executablePath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            `--force-device-scale-factor=${scale}`,
          ],
        });
      })(),
    };
  }
  return recordingBrowser.browser;
}

/**
 * Open a fresh page with the given viewport. The caller closes it.
 *
 * `reducedMotion` is a parameter rather than a constant because the two kinds
 * of capture want opposite things from it: a screenshot wants transitions off
 * so it cannot catch a mid-transition frame, a clip wants them on because they
 * are the subject. The runner passes what
 * {@link import('./recipe.js').resolveReducedMotion} decides.
 *
 * `forRecording` picks the browser: see {@link getRecordingBrowser} for why a
 * screencast needs its own.
 *
 * @param {Viewport} viewport
 * @param {{ reducedMotion?: 'reduce' | 'no-preference', forRecording?: boolean }} [opts]
 * @returns {Promise<import('puppeteer-core').Page>}
 */
export async function openPage(
  viewport = DEFAULT_VIEWPORT,
  { reducedMotion = 'reduce', forRecording = false } = {},
) {
  const browser = forRecording
    ? await getRecordingBrowser(viewport.deviceScaleFactor ?? 2)
    : await getPuppeteerBrowser({ featureName: 'Screenshot capture' });
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
    { name: 'prefers-reduced-motion', value: reducedMotion },
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
  const pending = recordingBrowser;
  recordingBrowser = null;
  if (pending) {
    try {
      await (await pending.browser).close();
    } catch {
      // already gone — ignore
    }
  }
  try {
    const browser = await getPuppeteerBrowser({
      featureName: 'Screenshot capture',
    });
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
