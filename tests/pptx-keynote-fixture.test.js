/**
 * The Keynote-saved PowerPoint fixture for the PPTX extractor (B828, track 1b
 * of B755). Unlike a pptxgenjs deck, it carries what a real presentation app
 * writes: placeholders, frames and backgrounds inherited from slideLayout and
 * slideMaster, and an empty body placeholder Keynote adds to most slides.
 *
 * Provenance: made 2026-10-22 in Keynote (theme "Basiskleur", 1920×1080)
 * with dummy content only, exported once as `slide-deck-keynote.pptx` and
 * `slide-deck-keynote.pdf`. Six slides: title, heading + list, heading +
 * table, heading + picture + text, heading + chart, section on a coloured
 * background. No client content; free to publish.
 *
 * This file pins the shape the extractor tests rely on, so a regenerated
 * fixture that loses a feature fails here first.
 *
 * Run with: node --test tests/pptx-keynote-fixture.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';

const zip = await JSZip.loadAsync(
  await fs.readFile(
    new URL('./fixtures/slide-deck-keynote.pptx', import.meta.url),
  ),
);
const read = (path) => zip.file(path).async('string');
const slides = await Promise.all(
  [1, 2, 3, 4, 5, 6].map((n) => read(`ppt/slides/slide${n}.xml`)),
);
const placeholders = (xml) =>
  [...xml.matchAll(/<p:ph type="([a-zA-Z]+)"/g)].map((m) => m[1]);

test('the fixture has six slides and a matching PDF export', async () => {
  const names = Object.keys(zip.files).filter((f) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(f),
  );
  assert.equal(names.length, 6);
  const pdf = await fs.readFile(
    new URL('./fixtures/slide-deck-keynote.pdf', import.meta.url),
  );
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('each slide carries its heading as a placeholder', () => {
  assert.deepEqual(placeholders(slides[0]).sort(), [
    'body',
    'ctrTitle',
    'subTitle',
  ]);
  for (const xml of slides.slice(1)) {
    assert.ok(placeholders(xml).includes('title'));
  }
});

test('list, table, picture and chart sit on their slides', () => {
  assert.match(slides[1], /Eerste punt[\s\S]*Tweede punt[\s\S]*Derde punt/);
  assert.match(slides[2], /<a:tbl>/);
  assert.ok(placeholders(slides[3]).includes('pic'));
  assert.match(slides[3], /<p:pic>/);
  assert.match(slides[4], /<c:chart /);
});

test('the coloured background is inherited from the layout', async () => {
  assert.doesNotMatch(slides[5], /<p:bg>/);
  const rels = await read('ppt/slides/_rels/slide6.xml.rels');
  const layout = rels.match(/slideLayouts\/(slideLayout\d+\.xml)/)[1];
  assert.match(
    await read(`ppt/slideLayouts/${layout}`),
    /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="003462"\/>/,
  );
});
