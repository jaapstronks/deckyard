/**
 * The AI route reads a PDF through `pdf-extract` (B772): what `convertFile()`
 * hands the model holds the running text of a letter, not its footnotes or
 * the reference marks that call them. The fixture is the Kamerbrief of the
 * generation suite (`nl-kamerbrief-duurzame-digitalisering`, public-domain
 * equivalent): three pages, eleven footnotes, two of them (7 and 8) above
 * the bottom 15% of their page.
 *
 * Run with: node --test tests/pdf-reader.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { readPdf } from '../server/utils/convert-file/pdf-reader.js';
import { formatSlidesForAi } from '../server/utils/convert-file/helpers.js';

const fixture = await fs.readFile(
  new URL('./fixtures/kamerbrief-duurzame-digitalisering.pdf', import.meta.url),
);
const parsed = await readPdf(fixture);
const aiInput = formatSlidesForAi(parsed.slides, parsed.metadata);

/** One distinctive fragment of each of the eleven footnotes. */
const FOOTNOTES = [
  'Onder twin transition verstaan we',
  'Manifest duurzame digitalisering – Nationale Coalitie',
  'https://coalitieduurzamedigitalisering.nl/',
  'A Competitiveness Compass for the EU',
  'Geannoteerde Agenda formele Telecomraad',
  'Kamerstuk 26 643, nr. 1327',
  'Kamerbrief bij Actieplan Duurzame Digitalisering | Kamerstuk',
  'Zie het Actieprogramma in de bijlage',
  'Moties lid B.C. Kathmann',
  'Sustainable IT Impact Assessment (SIIA)',
  'State of the Digital Decade, 2025: Verslag',
];

/**
 * The running text around each reference mark, which must close up once the
 * mark is gone (mark 1 stands between "economie" and "vooroploopt" in reading
 * order, 10 between "in" and "2025").
 */
const AROUND_MARKS = [
  'open economie vooroploopt',
  'het Manifest Duurzame Digitalisering. Bovendien',
  '‘koploper duurzame digitalisering’ te maken',
  'voor ons duurzaam concurrentievermogen.',
  'het Actieprogramma Duurzame Digitalisering aan zoals toegezegd',
  'Kamer is verstuurd.',
  'businessmodellen te ontwikkelen.',
  'De uitvoering van de nog openstaande moties',
  'het in 2025 gelanceerde Sustainable IT Impact Assessment',
  'als best practice zoals blijkt',
];

test('the letter is read as three pages of text, without errors', () => {
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.slides.map((s) => s.slideNumber),
    [1, 2, 3],
  );
});

test('none of the eleven footnotes reaches the AI input', () => {
  for (const footnote of FOOTNOTES) {
    assert.ok(
      !aiInput.includes(footnote),
      `footnote in the input: ${footnote}`,
    );
  }
});

test('no reference mark is left in the running text', () => {
  const flat = aiInput.replace(/\s+/g, ' ');
  for (const text of AROUND_MARKS) {
    assert.ok(flat.includes(text), `not closed up: ${text}`);
  }
  // Page 2 opens on the sentence that page 1 broke off, not on mark 7.
  assert.match(parsed.slides[1].textContent, /^Kamer is verstuurd\./);
});

test('the heading block of the first page goes along, the furniture does not', () => {
  const first = parsed.slides[0].textContent;
  assert.match(
    first,
    /Betreft Actieprogramma Duurzame Digitalisering 2026-2028/,
  );
  assert.match(first, /Datum 19 november 2025/);
  // Recurs on every page (the page number differs only in its digits).
  assert.ok(!aiInput.includes('Pagina 1 van 3'));
  assert.ok(!aiInput.includes('Ons kenmerk'));
  // Only the first page gets artifact text.
  assert.ok(!parsed.slides[1].textContent.includes('Directoraat-generaal'));
});

test('a damaged file gives an error, not a throw', async () => {
  const result = await readPdf(Buffer.from('%PDF-1.7 not really'));
  assert.deepEqual(result.slides, []);
  assert.equal(result.errors.length, 1);
});

test('an aborted signal rejects', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(readPdf(fixture, { signal: controller.signal }), /stop/);
});

test('a list keeps its items as list lines', async () => {
  const deck = await fs.readFile(
    new URL('./fixtures/slide-deck-tagged.pdf', import.meta.url),
  );
  const { slides } = await readPdf(deck);
  assert.equal(
    slides[1].textContent,
    [
      'What we learned',
      '- Customers want faster onboarding',
      '- Pricing is clear enough',
      '- Support response times improved',
      '- Mobile usage doubled',
    ].join('\n'),
  );
});
