/**
 * B219 (D116) — an undeclared string inside an `items` entry is offered to the
 * translator, so the fill job can close what the missing scan reports.
 *
 * Since D79 the value rule reaches item level: a string the type does not
 * declare is prose, and the missing-translation scan reports it when the
 * target lacks it. The prompt meta (`slideMeta.itemsFields`) used to come from
 * the type alone, so the model was told to translate only the declared
 * `itemKeys` and the reported gap could never be filled. The meta is now read
 * per slide: per items field, the union of the string keys over the entries of
 * both versions.
 *
 * The LLM seam is faked at `globalThis.fetch`, as in
 * nested-item-translation.test.js.
 *
 * Run with: node --test tests/translate-undeclared-item-strings.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';

/** The deck the fake model "returns", set per test. */
let aiResponse = '';
/** The user message of the last provider call, for prompt assertions. */
let lastUserMessage = '';

const realFetch = globalThis.fetch;
globalThis.fetch = async (_endpoint, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : null;
  lastUserMessage =
    body?.messages?.find((m) => m.role === 'user')?.content || '';
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: aiResponse } }] }),
  };
};
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const {
  translatePresentationStrings,
  translatePresentationStringsFillMissing,
} = await import('../server/utils/openai/translate.js');
const { computeMissingTranslation } =
  await import('../shared/i18n-progress.js');
const { translatableItemsFields, textFieldSpecForType } =
  await import('../shared/slide-types/text-fields.js');

const SLIDE_ID = 'tb1';

/**
 * A `text-blocks-slide` whose items carry one undeclared string at each
 * level: `rows[0].kicker` and `rows[1].blocks[0].aside`. `rows[0].weight` is
 * an undeclared number, a machine value that must stay out of the meta.
 * `withRemnants: false` gives the target that lacks both strings.
 */
function deck(lang, { withRemnants = true } = {}) {
  const nl = lang === 'nl';
  const row0 = {
    title: nl ? 'Rij een' : 'Row one',
    color: 'yellow',
    weight: 2,
    blocks: [{ title: nl ? 'Blok A' : 'Block A', body: '' }],
  };
  const block = { title: nl ? 'Blok C' : 'Block C', body: '' };
  if (withRemnants) {
    row0.kicker = nl ? 'Eerst' : 'First';
    block.aside = nl ? 'Terzijde' : 'Aside';
  }
  return {
    title: nl ? 'Het plan' : 'The plan',
    slides: [
      {
        id: SLIDE_ID,
        type: 'text-blocks-slide',
        notes: '',
        content: {
          title: nl ? 'Aanpak' : 'Approach',
          rows: [row0, { title: nl ? 'Rij twee' : 'Row two', blocks: [block] }],
        },
      },
    ],
  };
}

/** Shape the fake model's reply like a real one: title + slides + content. */
function reply(target) {
  return JSON.stringify({
    title: target.title,
    slides: target.slides.map((s) => ({
      id: s.id,
      type: s.type,
      content: s.content,
    })),
  });
}

function promptMeta() {
  return JSON.parse(
    lastUserMessage
      .slice(lastUserMessage.indexOf('SLIDE META'))
      .replace(/^SLIDE META[^\n]*\n/, ''),
  );
}

const RESULT_ROWS = (result) => result.slides[0].content.rows;

test('the per-slide meta lists undeclared item strings at every level', () => {
  const spec = textFieldSpecForType('text-blocks-slide');
  const fields = translatableItemsFields(
    spec,
    deck('nl').slides[0].content,
    deck('en-GB', { withRemnants: false }).slides[0].content,
  );
  assert.deepEqual(fields, [
    {
      key: 'rows',
      itemKeys: ['title', 'kicker'],
      itemsFields: [{ key: 'blocks', itemKeys: ['title', 'body', 'aside'] }],
    },
  ]);
  assert.deepEqual(
    translatableItemsFields(spec),
    [
      {
        key: 'rows',
        itemKeys: ['title'],
        itemsFields: [{ key: 'blocks', itemKeys: ['title', 'body'] }],
      },
    ],
    'without content the answer is the type alone',
  );
});

test('the scan reports the remnants, and the fill job closes them', async () => {
  const source = deck('nl');
  const target = deck('en-GB', { withRemnants: false });

  const { missing } = computeMissingTranslation({ source, target });
  assert.deepEqual(
    missing.map((m) => m.path),
    [
      ['rows', 0, 'kicker'],
      ['rows', 1, 'blocks', 0, 'aside'],
    ],
    'the premise: the scan reports both undeclared strings',
  );

  aiResponse = reply(deck('en-GB'));
  const filled = await translatePresentationStringsFillMissing(
    { sourcePresentation: source, targetPresentation: target, missing },
    { from: 'nl', to: 'en-GB' },
  );

  const rows = promptMeta()[0].itemsFields[0];
  assert.ok(rows.itemKeys.includes('kicker'), 'the prompt offers rows.kicker');
  assert.ok(
    rows.itemsFields[0].itemKeys.includes('aside'),
    'the prompt offers rows.blocks.aside',
  );
  assert.ok(!rows.itemKeys.includes('weight'), 'a number is not prose');

  assert.equal(RESULT_ROWS(filled)[0].kicker, 'First');
  assert.equal(RESULT_ROWS(filled)[1].blocks[0].aside, 'Aside');
  assert.equal(
    computeMissingTranslation({ source, target: filled }).missingCount,
    0,
    'after the fill nothing is missing',
  );
});

test('a full translation offers and merges the undeclared item strings', async () => {
  aiResponse = reply(deck('en-GB'));
  const out = await translatePresentationStrings(deck('nl'), {
    from: 'nl',
    to: 'en-GB',
  });

  const rows = promptMeta()[0].itemsFields[0];
  assert.deepEqual(rows.itemKeys, ['title', 'kicker']);
  assert.deepEqual(rows.itemsFields[0].itemKeys, ['title', 'body', 'aside']);
  assert.equal(RESULT_ROWS(out)[0].kicker, 'First');
  assert.equal(RESULT_ROWS(out)[1].blocks[0].aside, 'Aside');
  assert.equal(RESULT_ROWS(out)[0].weight, 2, 'machine values survive');
});
