/**
 * "Import slides as images" turns every page of a real PDF into a PNG (B701).
 *
 * `pdfToImages()` used to open a throwaway page that navigated to the PDF's
 * data URL "for the page count" before the pdf.js harness did the real work.
 * New headless Chrome treats a navigation to a PDF as a download and aborts
 * it, so Puppeteer threw `net::ERR_ABORTED` and every PDF import failed in
 * production; the page count already came from pdf.js. This runs a small
 * multi-page PDF, printed by the same browser, through the whole conversion.
 *
 * Whether such a navigation aborts depends on the build: Chrome with its PDF
 * viewer (CI, a desktop install) opens it, Chromium in the Docker image and
 * `chrome-headless-shell` download it. So the test also records every
 * navigation the conversion makes and refuses one to a PDF, which holds on
 * any browser.
 *
 * Run with: node --test tests/pdf-to-images-convert.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import {
  getPuppeteerBrowser,
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
  toNodeBuffer,
} from '../server/utils/puppeteer-browser.js';
import { pdfToImages } from '../server/render/pdf-to-images.js';

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());

/** Same gate as the export smoke test: skip locally without a browser, never in CI. */
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

after(() => closePuppeteerBrowser());

/** A PDF with one page per title, printed by the shared browser. */
async function printPdf(titles) {
  const browser = await getPuppeteerBrowser({ featureName: 'PDF Import test' });
  const page = await browser.newPage();
  try {
    const body = titles
      .map((t) => `<section style="page-break-after: always">${t}</section>`)
      .join('');
    await page.setContent(`<!DOCTYPE html><html><body>${body}</body></html>`);
    return toNodeBuffer(await page.pdf({ width: '960px', height: '540px' }));
  } finally {
    await page.close();
  }
}

/** PNG width and height from the IHDR chunk. */
function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('latin1'), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Record the URL of every top-level navigation in pages the shared browser
 * opens from now on. `pdfToImages()` takes the same browser instance.
 */
async function recordNavigations() {
  const browser = await getPuppeteerBrowser({ featureName: 'PDF Import test' });
  const urls = [];
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    page.on('request', (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        urls.push(req.url());
      }
    });
    return page;
  };
  return {
    urls,
    restore: () => {
      browser.newPage = newPage;
    },
  };
}

test('a multi-page PDF converts to one PNG per page', { skip }, async () => {
  const pdf = await printPdf(['One', 'Two', 'Three']);
  const progress = [];
  const navigations = await recordNavigations();

  let pages;
  try {
    pages = await pdfToImages({
      buffer: pdf,
      width: 640,
      height: 360,
      onProgress: (n, total) => progress.push([n, total]),
    });
  } finally {
    navigations.restore();
  }

  assert.deepEqual(
    navigations.urls.filter((url) => url.startsWith('data:application/pdf')),
    [],
    'no page navigates to the PDF: a browser without a PDF viewer aborts it',
  );

  assert.deepEqual(
    pages.map((p) => p.page),
    [1, 2, 3],
  );
  for (const { buffer } of pages) {
    assert.deepEqual(pngSize(buffer), { width: 640, height: 360 });
  }
  assert.deepEqual(progress, [
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
});
