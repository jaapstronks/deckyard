/**
 * Browser plumbing for the capture runner. Uses the same system Chrome/Chromium
 * the PDF and PNG exporters resolve — no extra browser download, no new
 * dependency — but launches it itself, because a capture needs a browser that
 * says it has a mouse (see {@link launchCaptureBrowser}).
 */

import { spawn } from 'node:child_process';

import puppeteer from 'puppeteer-core';

import { resolveChromeExecutablePath } from '../../server/utils/puppeteer-browser.js';

/** @typedef {{ width: number, height: number, deviceScaleFactor?: number }} Viewport */

/** Default capture viewport — the fixed convention for stable re-captures. */
export const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
};

/**
 * Height of the browser's own chrome (tabs, address bar) above the page, in
 * CSS pixels: what separates a window from a screen.
 */
const WINDOW_CHROME_HEIGHT = 88;

/**
 * Put the viewport in a window on a screen that holds it.
 *
 * Headless Chrome reports an 800×600 screen whatever the viewport, so every
 * capture viewport is a window larger than its own screen, a state no real
 * browser is in. The presenter reads a viewport that fills the screen as
 * fullscreen (`client/views/presenter/fullscreen.js`), so without this every
 * presenter capture shot the fullscreen layout: console gone, chrome hidden.
 *
 * The screen is as wide as the viewport and taller by the browser chrome: a
 * maximised window, which is what a presenter who did not pick fullscreen has.
 * Set over CDP because `page.setViewport()` has no screen size; it is the same
 * override, so it keeps the viewport and scale that call just set.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {Viewport} viewport
 * @returns {Promise<void>}
 */
async function emulateWindowScreen(page, viewport) {
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor ?? 2,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height + WINDOW_CHROME_HEIGHT,
  });
}

/**
 * Size of the virtual X screen, in device pixels. Large enough to hold the
 * biggest window a capture opens: a take is 1280×720 CSS pixels at a forced
 * 3×, so 3840×2160 native, plus the window's own chrome.
 */
const XVFB_SCREEN = '3840x2400x24';

/** @type {Promise<{ display: string, stop: () => void }> | null} */
let xvfb = null;

/**
 * A private X server for the capture browser, on Linux only.
 *
 * Headless Chrome on a Linux host without a mouse reports `(hover: none)` and
 * no `(pointer: fine)`, and nothing in a launch flag or a CDP emulation changes
 * that (tried: `Emulation.setEmulatedMedia`, `--blink-settings=primaryHoverType`,
 * `--touch-events=disabled`, `headless: 'shell'`). The editor then draws its
 * touch affordances permanently — dashed outlines round every field, "+" chips
 * over the numbers — and every editor shot from the canonical recorder
 * (dev-server-1) is a picture of the tablet UI. A headful Chrome on an X
 * display does report a mouse, so on Linux the capture browser is headful on
 * a virtual display it starts itself. macOS headless Chrome reports a mouse
 * already and stays headless.
 *
 * `-displayfd` lets Xvfb pick a free display and tell us which, so two runs on
 * one host (a manual capture next to the weekly refresh) do not collide.
 *
 * @returns {Promise<{ display: string, stop: () => void }>}
 */
function startXvfb() {
  xvfb ??= new Promise((resolve, reject) => {
    const child = spawn(
      'Xvfb',
      ['-displayfd', '3', '-screen', '0', XVFB_SCREEN, '-nolisten', 'tcp'],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] },
    );
    let out = '';
    child.once('error', (err) => {
      reject(
        err.code === 'ENOENT'
          ? new Error(
              'Capture on Linux needs Xvfb: headless Chrome there reports a ' +
                'touch screen, so the editor draws its touch affordances into ' +
                'every shot. Install it (apt install xvfb).',
            )
          : err,
      );
    });
    child.once('exit', (code) => {
      if (!out.includes('\n')) {
        reject(
          new Error(`Xvfb exited (code ${code}) before naming a display.`),
        );
      }
    });
    child.stdio[3].on('data', (chunk) => {
      out += chunk;
      if (!out.includes('\n')) return;
      resolve({ display: `:${out.trim()}`, stop: () => child.kill() });
    });
  });
  return xvfb;
}

/**
 * Launch a Chrome for capturing.
 *
 * Its own launch, not the app's export browser (`getPuppeteerBrowser()`): on
 * Linux it has to be headful on a virtual display (see {@link startXvfb}), and
 * the export browser a server runs has no business opening X windows.
 *
 * @param {string[]} [extraArgs] launch flags on top of the capture defaults
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function launchCaptureBrowser(extraArgs = []) {
  const executablePath = await resolveChromeExecutablePath();
  if (!executablePath) {
    throw new Error(
      'Capture needs a Chrome/Chromium executable. Install Chrome, or set ' +
        'PUPPETEER_EXECUTABLE_PATH to the browser binary.',
    );
  }
  const display =
    process.platform === 'linux' ? (await startXvfb()).display : null;
  return puppeteer.launch({
    headless: display === null,
    executablePath,
    env: display ? { ...process.env, DISPLAY: display } : process.env,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      ...extraArgs,
    ],
  });
}

/** @type {Promise<import('puppeteer-core').Browser> | null} */
let screenshotBrowser = null;

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
 * cannot go on the screenshot browser — forcing 3× there would render every
 * @2x shot at 3× and downsample it.
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
  recordingBrowser ??= {
    scale,
    browser: launchCaptureBrowser([`--force-device-scale-factor=${scale}`]),
  };
  return recordingBrowser.browser;
}

/**
 * Refuse a page that has no mouse.
 *
 * A capture on a touch-mode page is a wrong photograph, not jitter: the editor
 * swaps its hover affordances for always-visible touch ones, and no hash in the
 * registry moves when that happens. So the harness checks the input type the
 * page reports rather than trusting the host to be set up right.
 *
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<void>}
 */
async function assertMousePage(page) {
  const hover = await page.evaluate(
    () => globalThis.matchMedia('(hover: hover)').matches,
  );
  if (!hover) {
    throw new Error(
      'Capture page reports (hover: none): this browser renders the touch UI, ' +
        'so every editor shot would show touch affordances. Capture needs a ' +
        'browser with a mouse (headful on Xvfb on Linux; see lib/browser.js).',
    );
  }
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
    : await (screenshotBrowser ??= launchCaptureBrowser());
  const page = await browser.newPage();
  await assertMousePage(page);
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor ?? 2,
  });
  await emulateWindowScreen(page, viewport);
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
 * Close the capture browsers and their X server so the Node process can exit:
 * a live Chrome or Xvfb child keeps a one-shot CLI hanging after its last
 * capture.
 */
export async function closeBrowser() {
  const pending = [screenshotBrowser, recordingBrowser?.browser];
  screenshotBrowser = null;
  recordingBrowser = null;
  for (const browser of pending) {
    if (!browser) continue;
    try {
      await (await browser).close();
    } catch {
      // never launched or already gone — ignore
    }
  }
  const server = xvfb;
  xvfb = null;
  if (server) {
    try {
      (await server).stop();
    } catch {
      // never started — ignore
    }
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
