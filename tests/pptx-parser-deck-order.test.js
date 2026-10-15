/**
 * The interpreting PPTX import reads the deck in deck order and pairs notes
 * through the relationships (B702).
 *
 * `parsePptx` used to sort the slide parts by the number in their name and to
 * look for `notesSlides/notesSlideN.xml` with the same number. A deck that was
 * reordered in PowerPoint keeps its old part names, so the slides came out in
 * the old order with another slide's notes, and the slide-number field of the
 * notes page leaked into `notes`. Now it walks the list `pptx-notes.js` reads
 * from `ppt/presentation.xml`.
 *
 * Run with: node --test tests/pptx-parser-deck-order.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { toNodeBuffer } from '../server/utils/puppeteer-browser.js';
import { parsePptx } from '../server/utils/convert-file/pptx-parser.js';

let PptxGenJS = null;
try {
  PptxGenJS = (await import('pptxgenjs')).default;
  // eslint-disable-next-line no-restricted-syntax -- an install without optional dependencies has no deck writer; the tests that need one skip
} catch {
  // skipped below
}
const noPptxgen = PptxGenJS ? false : 'pptxgenjs is not installed';

const NOTES = {
  one: 'Notes for One & <co>\nsecond line',
  three: 'Notes for Three & <co>\nsecond line',
  four: 'Notes for Four & <co>\nsecond line',
};

/** Four slides; the second has no notes, the third is hidden. */
async function sampleDeck() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const titles = ['One', 'Two', 'Three', 'Four'];
  titles.forEach((title, i) => {
    const slide = pptx.addSlide();
    slide.addText(`Slide ${title}`, { x: 1, y: 1, w: 8, h: 1, fontSize: 40 });
    if (i !== 1) slide.addNotes(`Notes for ${title} & <co>\nsecond line`);
    if (i === 2) slide.hidden = true;
  });
  return toNodeBuffer(await pptx.write({ outputType: 'nodebuffer' }));
}

/** The sample deck with its slide list reversed, part names untouched. */
async function reorderedDeck() {
  const zip = await JSZip.loadAsync(await sampleDeck());
  const presXml = await zip.file('ppt/presentation.xml').async('string');
  const reordered = presXml.replace(
    /(<p:sldIdLst\b[^>]*>)([\s\S]*?)(<\/p:sldIdLst>)/,
    (_, open, body, close) =>
      open +
      (body.match(/<p:sldId\b[^>]*\/>/g) || []).reverse().join('') +
      close,
  );
  assert.notEqual(reordered, presXml);
  zip.file('ppt/presentation.xml', reordered);
  return zip;
}

test(
  'parsePptx: slides in deck order, numbered by position, each with its own notes',
  { skip: noPptxgen },
  async () => {
    const { slides, errors } = await parsePptx(await sampleDeck());
    assert.deepEqual(errors, []);
    assert.deepEqual(
      slides.map((s) => [s.slideNumber, s.textContent, s.notes]),
      [
        [1, 'Slide One', NOTES.one],
        [2, 'Slide Two', ''],
        [3, 'Slide Three', NOTES.three],
        [4, 'Slide Four', NOTES.four],
      ],
    );
  },
);

test(
  'parsePptx: a reordered deck follows presentation.xml, and the notes follow the slide',
  { skip: noPptxgen },
  async () => {
    const zip = await reorderedDeck();
    const { slides, errors } = await parsePptx(
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(
      slides.map((s) => [s.slideNumber, s.textContent, s.notes]),
      [
        [1, 'Slide Four', NOTES.four],
        [2, 'Slide Three', NOTES.three],
        [3, 'Slide Two', ''],
        [4, 'Slide One', NOTES.one],
      ],
    );
  },
);

test(
  'parsePptx: the slide-number field of the notes page stays out of the notes',
  { skip: noPptxgen },
  async () => {
    const zip = await JSZip.loadAsync(await sampleDeck());
    const notesXml = await zip
      .file('ppt/notesSlides/notesSlide1.xml')
      .async('string');
    // The regression this guards: the notes page carries a slide-number
    // placeholder, which the old whole-page reading took along as text.
    assert.match(notesXml, /<p:ph\b[^>]*type="sldNum"/);
    const { slides } = await parsePptx(await sampleDeck());
    assert.equal(slides[0].notes, NOTES.one);
  },
);

test('parsePptx: a package without a slide list falls back to part-number order', async () => {
  const slideXml = (text) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
  const zip = new JSZip();
  zip.file('ppt/slides/slide10.xml', slideXml('Tenth part'));
  zip.file('ppt/slides/slide2.xml', slideXml('Second part'));
  const { slides, errors } = await parsePptx(
    await zip.generateAsync({ type: 'nodebuffer' }),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    slides.map((s) => [s.slideNumber, s.textContent, s.notes]),
    [
      [1, 'Second part', ''],
      [2, 'Tenth part', ''],
    ],
  );
});
