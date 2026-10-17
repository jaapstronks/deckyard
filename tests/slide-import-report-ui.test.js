/**
 * The creation view's "PowerPoint or PDF" sub-tab (B753): the two ways to
 * take a deck over, editable slides first, and the one line that says which
 * pages of an editable import became images and why.
 *
 * The route and its report are pinned by import-slides-route.test.js and
 * deck-slides-import.test.js; this pins how the client reads them.
 *
 * Run with: node --test tests/slide-import-report-ui.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { slidesImportOutcome } =
  await import('../client/views/slide-import/index.js');
const { FALLBACK_REASONS } =
  await import('../server/services/deck-slides-import.js');
const { createPptxPdfImportPanel } =
  await import('../client/views/list/modals/creation-view/import-pptx-pdf.js');

test('a report with every page editable is clean and counts the pages', () => {
  const outcome = slidesImportOutcome({
    slidesExtracted: 4,
    slidesConverted: 4,
    errors: [],
    pages: [1, 2, 3, 4].map((page) => ({ page, type: 'content-slide' })),
  });
  assert.equal(outcome.clean, true);
  assert.equal(outcome.line, 'All 4 pages were imported as editable slides.');
  assert.deepEqual(outcome.errors, []);
});

test('fallback pages are named in one line, each with its reason', () => {
  const outcome = slidesImportOutcome({
    slidesExtracted: 12,
    slidesConverted: 9,
    errors: [],
    pages: [
      { page: 1, type: 'title-slide' },
      { page: 5, type: 'image-slide', reason: 'drawing' },
      { page: 7, type: 'image-slide', reason: 'table-untagged' },
      { page: 9, type: 'image-slide', reason: 'no-text' },
    ],
  });
  assert.equal(outcome.clean, false);
  assert.equal(
    outcome.line,
    '3 of 12 pages were taken over as images: 5 (chart), 7 (table), 9 (no text).',
  );
});

test('every fallback reason the server names has its own words', () => {
  const reasons = FALLBACK_REASONS;
  const { line } = slidesImportOutcome({
    slidesExtracted: reasons.length,
    pages: reasons.map((reason, i) => ({ page: i + 1, reason })),
  });
  assert.match(line, /\(too much text for one slide\)/);
  for (const [i] of reasons.entries()) {
    assert.match(line, new RegExp(`\\b${i + 1} \\([a-z ]+\\)`));
  }
});

test('a reason the client does not know shows the page alone', () => {
  const { line } = slidesImportOutcome({
    slidesExtracted: 2,
    pages: [{ page: 2, reason: 'something-new' }],
  });
  assert.equal(line, '1 of 2 pages was taken over as an image: 2.');
});

test('a failed upload is not clean and names its page', () => {
  const outcome = slidesImportOutcome({
    slidesExtracted: 3,
    pages: [1, 2, 3].map((page) => ({ page, type: 'content-slide' })),
    errors: [{ page: 2, message: 'An image could not be uploaded' }],
  });
  assert.equal(outcome.clean, false);
  assert.deepEqual(outcome.errors, ['Page 2: An image could not be uploaded']);
});

test('the sub-tab offers editable slides first and checked, images second', () => {
  const { el } = createPptxPdfImportPanel();
  const radios = [...el.querySelectorAll('input[type="radio"]')];
  assert.deepEqual(
    radios.map((r) => r.value),
    ['slides', 'images'],
  );
  assert.equal(radios[0].checked, true);
  assert.equal(radios[1].checked, false);
  assert.equal(radios[0].name, radios[1].name);
  const titles = [...el.querySelectorAll('.share-option-title')].map(
    (n) => n.textContent,
  );
  assert.deepEqual(titles, ['As editable slides', 'As images']);
});

test('the picker hint follows the chosen way', () => {
  const { el } = createPptxPdfImportPanel();
  const hint = () =>
    el.querySelector('.import-slides-dropzone-hint').textContent;
  assert.match(hint(), /gives the slides/);
  const images = el.querySelector('input[value="images"]');
  images.checked = true;
  images.dispatchEvent(new dom.window.Event('change'));
  assert.match(hint(), /gives the images/);
});
