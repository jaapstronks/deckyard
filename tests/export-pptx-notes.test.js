/**
 * PPTX export: speaker notes and document author (B255).
 *
 * Why this file runs without a browser: `buildPptxBuffer` rasterises every
 * regular slide through headless Chrome, which is why the PPTX success path
 * lives in `export-chrome-smoke.test.js` and is skipped on machines without a
 * browser. A `video-slide` never takes that path — an unrecognised or
 * YouTube/Vimeo source composes a placeholder from shapes and text, no render
 * and no network — so a deck of video slides exercises the parts B255 is about
 * (the notes part and `docProps/core.xml`) everywhere the suite runs.
 *
 * The raster branch is covered in `export-chrome-smoke.test.js`; both branches
 * attach notes through the same call site in `server/export/pptx.js`.
 *
 * Run with: node --test tests/export-pptx-notes.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { buildPptxBuffer } from '../server/export/pptx.js';

const repoRoot = '.';

/**
 * A video slide with an unrecognised source: composes a placeholder, so the
 * export needs neither Chrome nor the network.
 */
function videoSlide(id, notes) {
  const slide = {
    id,
    type: 'video-slide',
    content: { source: '', title: `Slide ${id}` },
  };
  if (notes !== undefined) slide.notes = notes;
  return slide;
}

/** The `<a:t>` runs of one notes part, minus the trailing slide-number field. */
async function notesTextRuns(zip, slideNum) {
  const part = zip.file(`ppt/notesSlides/notesSlide${slideNum}.xml`);
  assert.ok(part, `notesSlide${slideNum}.xml should exist`);
  const xml = await part.async('string');
  const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
  // pptxgenjs always ends the part with the slide-number placeholder.
  assert.equal(
    runs.at(-1),
    String(slideNum),
    'the last run should be the slide-number field',
  );
  return runs.slice(0, -1);
}

async function buildDeck(slides) {
  const { buffer } = await buildPptxBuffer(
    repoRoot,
    { title: 'Notes export', slides },
    { scale: 1 },
  );
  return JSZip.loadAsync(Buffer.from(buffer));
}

test('a slide with notes carries them as PowerPoint notes', async () => {
  const zip = await buildDeck([videoSlide('a', 'First line.\nSecond line.')]);

  const runs = await notesTextRuns(zip, 1);
  const text = runs.join('');
  assert.ok(
    text.includes('First line.'),
    `the notes part should carry the notes text, got: ${JSON.stringify(text)}`,
  );
  assert.ok(
    text.includes('Second line.'),
    'a multi-line note should survive whole, not just its first line',
  );
});

test('a slide without notes gets no note text', async () => {
  // pptxgenjs writes a notes part for every slide to keep the _rels numbering
  // intact, so the assertion is on the text, not on the part's existence.
  const zip = await buildDeck([
    videoSlide('a', 'Only this slide speaks.'),
    videoSlide('b'),
    videoSlide('c', '   \n  '),
  ]);

  assert.ok(
    (await notesTextRuns(zip, 1)).join('').includes('Only this slide speaks.'),
    'slide 1 should keep its notes',
  );
  assert.equal(
    (await notesTextRuns(zip, 2)).join(''),
    '',
    'a slide without a notes field should carry no note text',
  );
  assert.equal(
    (await notesTextRuns(zip, 3)).join(''),
    '',
    'whitespace-only notes are no notes',
  );
});

test('notes follow the slide order, one part per slide', async () => {
  const zip = await buildDeck([
    videoSlide('a', 'Note A'),
    videoSlide('b', 'Note B'),
  ]);

  assert.ok((await notesTextRuns(zip, 1)).join('').includes('Note A'));
  assert.ok((await notesTextRuns(zip, 2)).join('').includes('Note B'));
  assert.equal(
    Object.keys(zip.files).filter(
      (name) =>
        name.startsWith('ppt/notesSlides/notesSlide') && name.endsWith('.xml'),
    ).length,
    2,
    'two slides in → two notes parts out',
  );
});

test('the document author is the configured APP_NAME', async () => {
  const saved = process.env.APP_NAME;
  try {
    process.env.APP_NAME = 'Acme Decks';
    const zip = await buildDeck([videoSlide('a')]);
    const core = await zip.file('docProps/core.xml').async('string');
    assert.match(core, /<dc:creator>Acme Decks<\/dc:creator>/);
    assert.match(core, /<cp:lastModifiedBy>Acme Decks<\/cp:lastModifiedBy>/);
  } finally {
    if (saved === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = saved;
  }
});

test('the document author defaults to the product name', async () => {
  const saved = process.env.APP_NAME;
  try {
    delete process.env.APP_NAME;
    const zip = await buildDeck([videoSlide('a')]);
    const core = await zip.file('docProps/core.xml').async('string');
    assert.match(core, /<dc:creator>Deckyard<\/dc:creator>/);
    assert.doesNotMatch(
      core,
      /Slide Deck Builder/,
      'the pre-fork author string should be gone',
    );
  } finally {
    if (saved === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = saved;
  }
});
