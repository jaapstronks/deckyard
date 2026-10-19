/**
 * Chart labels in a tagged PDF come out once (B778). Chrome tags an SVG chart
 * as one `Figure` whose content references point at the same marked-content id
 * once per label group, so `p24R_mc0` appears nine times under it. Each
 * reference used to pull the same runs again: an imported Deckyard deck with a
 * chart read its axis as `555555555` and `AlfaAlfaAlfa…`.
 *
 * The fixture is the chart slide of the export-metrics all-field-types deck,
 * printed by Deckyard's own PDF export. It is committed, so this test never
 * starts a browser. To regenerate it, run from the core root:
 *
 *   node --input-type=module -e "
 *     import fs from 'node:fs';
 *     import { initSanitizer } from './shared/sanitize.js';
 *     await initSanitizer();
 *     const { renderSlidesToPdfBuffer } = await import('./server/render/pdf.js');
 *     const { closePuppeteerBrowser, toNodeBuffer } = await import('./server/utils/puppeteer-browser.js');
 *     const { allFieldTypesDeck } = await import('./tests/fixtures/export-metrics/fixtures.js');
 *     const deck = allFieldTypesDeck();
 *     deck.slides = deck.slides.filter((s) => s.type === 'chart-slide');
 *     fs.writeFileSync('tests/fixtures/chart-slide-tagged.pdf', toNodeBuffer(await renderSlidesToPdfBuffer(process.cwd(), deck, {})));
 *     await closePuppeteerBrowser();
 *   "
 *
 * Run with: node --test tests/pdf-extract-chart-labels.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  extractPdfPages,
  pageText,
} from '../server/utils/pdf-extract/index.js';

const fixture = await fs.readFile(
  new URL('./fixtures/chart-slide-tagged.pdf', import.meta.url),
);
const result = await extractPdfPages(fixture);
const [chart] = result.pages;

test('the chart slide is read through its structure tree', () => {
  assert.equal(result.pageCount, 1);
  assert.equal(chart.tagged, true);
  assert.equal(chart.heading, 'Chart data');
});

test('every chart label is a drawing label exactly once', () => {
  assert.deepEqual(
    chart.drawing.labels.map((l) => l.text),
    ['5', '4', '3', '2', '1', '0', 'Alfa Bravo Charlie'],
  );
});

test('the page text names each label once', () => {
  const text = pageText(chart);
  for (const label of ['Alfa', 'Bravo', 'Charlie']) {
    assert.equal(text.split(label).length - 1, 1, `${label} once in: ${text}`);
  }
  for (const digit of '012345') {
    assert.equal(text.split(digit).length - 1, 1, `${digit} once in: ${text}`);
  }
});
