/**
 * The screenshot half of T1.1 criterion 1: edition A still *looks* the same.
 *
 * `tests/renderer-bundle-isolation.test.js` proves the documents are
 * byte-identical, which is the stronger claim about the HTML. It is not the
 * whole claim: what a reader sees is the HTML plus the stylesheets plus the
 * fonts, and a frozen renderer that emitted the same markup against the
 * current CSS would pass that test and still have changed the page. So this
 * file paints revision A's document in a real browser before and after
 * revision B changed a stylesheet and a slide type, and compares the pixels.
 *
 * Both screenshots come from one browser in one process, so a byte comparison
 * is the right instrument here: the thing under test is whether the *input to
 * Chrome* changed, not whether two machines rasterise identically. That is also
 * the limit of what a frozen renderer can promise, and
 * `docs/reference/renderer-bundle.md` § Limits says so: the bundle freezes the
 * input and the render logic, never the browser.
 *
 * Requires Chrome, like the other browser tests: skipped locally when none is
 * installed, never skipped in CI.
 *
 * Run with: node --test tests/renderer-bundle-screenshot.test.js
 */

import { renderTrustedEditionForProof } from './helpers/renderer-bundle-process.js';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import {
  closePuppeteerBrowser,
  getPuppeteerBrowser,
  resolveChromeExecutablePath,
  toNodeBuffer,
} from '../server/utils/puppeteer-browser.js';
import { loadExportDocument } from '../server/render/load-export-document.js';
import { settleRenderedPage } from '../server/utils/settle-rendered-page.js';
import { openRendererBundle } from '../server/render/renderer-bundle/index.js';
import {
  MARKERS,
  buildBundle,
  frozenEditionInput,
  makeRevisionB,
  stageSource,
  tempDir,
} from './helpers/renderer-bundle.js';

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

let scratch = null;
after(async () => {
  await closePuppeteerBrowser();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

/**
 * The deck's own stage, painted at the size it is designed for.
 *
 * The stage element rather than the viewport, on purpose: the presenter chrome
 * around it hides itself on a timer (`chrome-autohide`), so a full-page shot
 * records *when* it was taken as much as what was rendered - it compared equal
 * on one run and unequal on the next. The stage is the part of the page the
 * edition decides, which is the part a frozen renderer promises to keep.
 */
async function shoot(html) {
  const browser = await getPuppeteerBrowser({ featureName: 'Renderer bundle' });
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await loadExportDocument(page, html, { label: 'renderer bundle' });
    await settleRenderedPage(page);
    const stage = await page.$('#stage');
    assert.ok(stage, 'the canvas document has no #stage element');
    return toNodeBuffer(await stage.screenshot({ type: 'png' }));
  } finally {
    try {
      await page.close();
    } catch {
      // The comparison below is what matters; a page that will not close is
      // the browser teardown's problem.
    }
  }
}

test(
  'edition A renders the same pixels after revision B changed CSS and a slide type',
  { skip },
  async () => {
    scratch = await tempDir('deckyard-renderer-shot-');
    const store = path.join(scratch, 'store');
    const input = frozenEditionInput();

    const a = await buildBundle({ storeDir: store });
    const bundleA = await openRendererBundle(store, a.rendererHash);
    const beforeHtml = (await renderTrustedEditionForProof(bundleA, input))
      .canvas;
    const before = await shoot(beforeHtml);

    const srcB = await stageSource(
      path.join(a.dir, 'files'),
      path.join(scratch, 'srcB'),
    );
    await makeRevisionB(srcB);
    const b = await buildBundle({ storeDir: store, sourceRoot: srcB });
    const bundleB = await openRendererBundle(store, b.rendererHash);
    const changed = await shoot(
      (await renderTrustedEditionForProof(bundleB, input)).canvas,
    );

    // Rendered again from revision A, now that B exists and B's sources differ.
    const afterHtml = (await renderTrustedEditionForProof(bundleA, input))
      .canvas;
    const after = await shoot(afterHtml);

    assert.ok(before.length > 10_000, 'the screenshot is suspiciously small');
    assert.ok(
      before.equals(after),
      'edition A painted different pixels after revision B was built',
    );
    assert.ok(
      !changed.equals(before),
      `revision B changed the stylesheet and the subtitle markup, so the page must look different; check the ${MARKERS.revisionB} rule`,
    );
  },
);
