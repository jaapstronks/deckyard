/**
 * Missing-fill translates per path: an empty target field gets the
 * translation of the source value on the same path, and nothing else
 * (DY-773).
 *
 * The fill used to send the model both versions whole and ask it to fill the
 * blanks. In a timeline whose EN version had drifted a position behind NL,
 * it filled the one empty EN entry with the translations of three
 * *different* NL items' texts; the 39 characters it put in `date` (max 30)
 * then refused every later save of that slide. The model now receives only
 * the gaps' source strings, as an isolated field map, and each answer lands
 * on the one path it was asked for.
 *
 * The LLM seam is faked at `globalThis.fetch`, as in
 * nested-item-translation.test.js.
 *
 * Run with: node --test tests/fill-missing-per-path.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';

/** Field maps the fake model was asked to translate, one per call. */
let asked = [];

const realFetch = globalThis.fetch;
globalThis.fetch = async (_endpoint, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : null;
  const user = body?.messages?.find((m) => m.role === 'user')?.content || '';
  const { fields } = JSON.parse(user);
  asked.push(fields);
  // A translation that names its source, so a test can see where it came from.
  const translations = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, `EN(${v})`]),
  );
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ translations }) } }],
      }),
  };
};
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const { translatePresentationStringsFillMissing } =
  await import('../server/utils/openai/translate.js');
const { computeMissingTranslation } =
  await import('../shared/i18n-progress.js');

const entry = (date, title, text) => ({ date, title, text });

function timeline(items) {
  return {
    title: 'Tijdlijn CIIIC 2027',
    slides: [
      {
        id: 'tl',
        type: 'timeline-slide',
        content: { title: 'Tijdlijn', items },
      },
    ],
  };
}

test('an empty entry in a shifted target collection gets its own source path only', async () => {
  asked = [];
  const source = timeline([
    entry('28 januari', 'IFFR', 'Filmfestival Rotterdam'),
    entry('29 januari', 'ADRIE 2B', 'Tweede bijeenkomst'),
    entry('5 februari', 'Opening', 'Opening van het nieuwe pand'),
  ]);
  // EN lost the two January entries and kept a shifted remnant, plus one
  // fully empty entry: the shape the drift left in the real deck.
  const target = {
    title: 'CIIIC 2027 timeline',
    slides: [
      {
        id: 'tl',
        type: 'timeline-slide',
        content: {
          title: 'Timeline',
          items: [
            entry('5 February', 'Opening', 'Opening of the new building'),
            entry('', '', ''),
            entry('5 February', 'Opening', 'Opening of the new building'),
          ],
        },
      },
    ],
  };

  const filled = await translatePresentationStringsFillMissing(
    { sourcePresentation: source, targetPresentation: target },
    { from: 'nl', to: 'en-GB' },
  );

  assert.deepEqual(
    asked.flatMap((fields) => Object.values(fields)),
    ['29 januari', 'ADRIE 2B', 'Tweede bijeenkomst'],
    'the model sees only the source values on the empty paths',
  );
  const out = filled.slides[0].content.items;
  assert.deepEqual(out[1], {
    date: 'EN(29 januari)',
    title: 'EN(ADRIE 2B)',
    text: 'EN(Tweede bijeenkomst)',
  });
  assert.deepEqual(out[0], target.slides[0].content.items[0], 'kept as is');
  assert.deepEqual(out[2], target.slides[0].content.items[2], 'kept as is');
  assert.equal(filled.title, 'CIIIC 2027 timeline', 'a filled title is kept');
});

test('nothing missing asks the model nothing', async () => {
  asked = [];
  const source = timeline([entry('2020', 'Start', 'Begin')]);
  const target = timeline([entry('2020', 'Start', 'Beginning')]);
  const filled = await translatePresentationStringsFillMissing(
    { sourcePresentation: source, targetPresentation: target },
    { from: 'nl', to: 'en-GB' },
  );
  assert.equal(asked.length, 0);
  assert.deepEqual(filled.slides, target.slides);
});

test('the fill closes exactly the gaps the scan reports', async () => {
  asked = [];
  const source = timeline([
    entry('2020', 'Start', 'Begin'),
    entry('2021', 'Groei', 'Meer mensen'),
  ]);
  const target = timeline([entry('2020', 'Start', ''), entry('', '', '')]);
  target.title = '';
  const { missingCount } = computeMissingTranslation({ source, target });
  const filled = await translatePresentationStringsFillMissing(
    { sourcePresentation: source, targetPresentation: target },
    { from: 'nl', to: 'en-GB' },
  );
  assert.equal(Object.keys(asked[0]).length, missingCount);
  assert.equal(
    computeMissingTranslation({ source, target: filled }).missingCount,
    0,
  );
  assert.equal(filled.title, 'EN(Tijdlijn CIIIC 2027)');
});

test('a large fill is split over several calls, each value still on its path', async () => {
  asked = [];
  const long = 'x'.repeat(2500);
  const source = timeline(
    [1, 2, 3, 4].map((n) => entry(`${n}`, `${n}`, `${n}${long}`)),
  );
  const target = timeline([1, 2, 3, 4].map((n) => entry(`${n}`, `${n}`, '')));
  const filled = await translatePresentationStringsFillMissing(
    { sourcePresentation: source, targetPresentation: target },
    { from: 'nl', to: 'en-GB' },
  );
  assert.ok(asked.length > 1, 'more than one model call');
  filled.slides[0].content.items.forEach((it, i) => {
    assert.equal(it.text, `EN(${i + 1}${long})`);
  });
});
