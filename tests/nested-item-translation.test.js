/**
 * B164 — nested item texts survive a round trip through the translate
 * pipeline.
 *
 * `text-blocks-slide` is the one registry type with an `items` field inside an
 * `items` field: `rows[].blocks[].title/body`. The translate pipeline used to
 * walk exactly one level, so those texts were never sent to the model and
 * never merged back — while the collab codec (`textFieldSpec`) already walked
 * them recursively, so the two disagreed about the same type. The rule is now
 * one recursion, `mapItemTexts`, shared by the translate merge, the editor's
 * save-time language sync and the missing-translation scan.
 *
 * The LLM seam is faked at `globalThis.fetch` (same pattern as
 * digest-generation.test.js): no experimental module-mock flags, and the real
 * getLlmConfig → provider → parse chain still runs.
 *
 * Run with: node --test tests/nested-item-translation.test.js
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
const { buildBlankTargetFromSource, computeMissingTranslation } =
  await import('../shared/i18n-progress.js');
const { mapItemTexts, textFieldSpecForType, translatableItemsFieldsForType } =
  await import('../shared/slide-types/text-fields.js');

const SLIDE_ID = 'tb1';

/**
 * A one-slide deck whose only prose lives two levels deep, plus non-text
 * neighbours (`color`, `arrow`) that must survive untouched.
 */
function deck(lang) {
  const nl = lang === 'nl';
  return {
    title: nl ? 'Het plan' : 'The plan',
    slides: [
      {
        id: SLIDE_ID,
        type: 'text-blocks-slide',
        notes: '',
        content: {
          title: nl ? 'Aanpak' : 'Approach',
          rows: [
            {
              title: nl ? 'Rij een' : 'Row one',
              color: 'yellow',
              arrow: 'down',
              blocks: [
                {
                  title: nl ? 'Blok A' : 'Block A',
                  body: nl ? 'Tekst A' : 'Text A',
                },
                {
                  title: nl ? 'Blok B' : 'Block B',
                  body: nl ? 'Tekst B' : 'Text B',
                },
              ],
            },
            {
              title: nl ? 'Rij twee' : 'Row two',
              color: 'black',
              arrow: 'none',
              blocks: [
                {
                  title: nl ? 'Blok C' : 'Block C',
                  body: nl ? 'Tekst C' : 'Text C',
                },
              ],
            },
          ],
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

const rowsOf = (result) => result.slides[0].content.rows;

test('the model is told about the nested items field', async () => {
  aiResponse = reply(deck('en-GB'));
  await translatePresentationStrings(deck('nl'), { from: 'nl', to: 'en-GB' });

  const meta = JSON.parse(
    lastUserMessage
      .slice(lastUserMessage.indexOf('SLIDE META'))
      .replace(/^SLIDE META[^\n]*\n/, ''),
  );
  const rows = meta[0].itemsFields.find((f) => f.key === 'rows');
  assert.ok(rows, 'slideMeta must list the rows items field');
  assert.deepEqual(rows.itemKeys, ['title']);
  assert.deepEqual(rows.itemsFields, [
    { key: 'blocks', itemKeys: ['title', 'body'] },
  ]);
});

test('nested item texts round-trip across two languages', async () => {
  // nl -> en-GB
  aiResponse = reply(deck('en-GB'));
  const toEn = await translatePresentationStrings(deck('nl'), {
    from: 'nl',
    to: 'en-GB',
  });
  const en = rowsOf(toEn);
  assert.equal(en[0].blocks[0].title, 'Block A');
  assert.equal(en[0].blocks[0].body, 'Text A');
  assert.equal(en[0].blocks[1].title, 'Block B');
  assert.equal(en[1].blocks[0].body, 'Text C');
  assert.equal(en[0].title, 'Row one', 'the row heading translates too');
  // Non-text neighbours follow the source, at both levels.
  assert.equal(en[0].color, 'yellow');
  assert.equal(en[1].arrow, 'none');

  // en-GB -> nl, and we are back where we started.
  aiResponse = reply(deck('nl'));
  const backToNl = await translatePresentationStrings(toEn, {
    from: 'en-GB',
    to: 'nl',
  });
  assert.deepEqual(rowsOf(backToNl), rowsOf(deck('nl')));
});

test('a nested text the model skipped keeps the source value, per index', async () => {
  const partial = deck('en-GB');
  // Model returns row 0 block 1 untranslated (missing key), everything else fine.
  delete partial.slides[0].content.rows[0].blocks[1].title;
  aiResponse = reply(partial);

  const out = rowsOf(
    await translatePresentationStrings(deck('nl'), { from: 'nl', to: 'en-GB' }),
  );
  assert.equal(out[0].blocks[0].title, 'Block A', 'index 0 is not disturbed');
  assert.equal(
    out[0].blocks[1].title,
    'Blok B',
    'index 1 falls back to source',
  );
  assert.equal(out[0].blocks[1].body, 'Text B', 'its sibling key still lands');
});

test('the missing-translation scan sees nested item texts', () => {
  const source = deck('nl');
  const target = deck('en-GB');
  target.slides[0].content.rows[0].blocks[1].body = '';

  const { missing } = computeMissingTranslation({ source, target });
  assert.deepEqual(
    missing.map((m) => m.path),
    [['rows', 0, 'blocks', 1, 'body']],
  );
  assert.equal(missing[0].slideId, SLIDE_ID);

  assert.equal(
    computeMissingTranslation({ source, target: deck('en-GB') }).missingCount,
    0,
    'a fully translated deck reports nothing missing',
  );
});

test('a blank target blanks nested item texts, not their structure', () => {
  const blank = buildBlankTargetFromSource(deck('nl'));
  const rows = blank.slides[0].content.rows;
  assert.equal(rows[0].blocks[1].title, '');
  assert.equal(rows[0].blocks[1].body, '');
  assert.equal(rows[0].color, 'yellow', 'non-text values survive');
  assert.equal(rows[1].blocks.length, 1, 'item counts follow the source');
});

test('fillMissing fills only the empty nested text', async () => {
  const source = deck('nl');
  const target = deck('en-GB');
  target.slides[0].content.rows[0].blocks[1].body = '';
  // The model answers with everything; only the blank may be taken.
  const answer = deck('en-GB');
  answer.slides[0].content.rows[0].blocks[0].body = 'DO NOT TAKE';
  answer.slides[0].content.rows[0].blocks[1].body = 'Text B';
  aiResponse = reply(answer);

  const filled = await translatePresentationStringsFillMissing(
    { sourcePresentation: source, targetPresentation: target, missing: [] },
    { from: 'nl', to: 'en-GB' },
  );
  const rows = rowsOf(filled);
  assert.equal(rows[0].blocks[1].body, 'Text B', 'the blank is filled');
  assert.equal(
    rows[0].blocks[0].body,
    'Text A',
    'a non-empty target text is never overwritten',
  );
});

test('mapItemTexts: a base wins all the way down, and never inherits source prose', () => {
  const spec = textFieldSpecForType('text-blocks-slide').items.get('rows');
  const src = deck('nl').slides[0].content.rows;

  // Base knows row 0 only; row 1 must not fall back to the Dutch source text.
  const base = [{ title: 'Row one', blocks: [{ title: 'Block A' }] }];
  const out = mapItemTexts(src, spec, {
    base,
    path: ['rows'],
    resolve: () => undefined,
  });
  assert.equal(out[0].title, 'Row one');
  assert.equal(out[0].blocks[0].title, 'Block A');
  assert.equal(out[0].blocks[1].title, undefined, 'unknown item starts empty');
  assert.equal(out[1].title, undefined, 'unknown row starts empty');
  assert.equal(out.length, 2, 'count still follows the source');
});

test('every registry items field with nested text is reachable', () => {
  // The projection and the spec must agree about where prose lives; the one
  // nested case in the registry today is text-blocks-slide.
  const fields = translatableItemsFieldsForType('text-blocks-slide');
  assert.deepEqual(fields, [
    {
      key: 'rows',
      itemKeys: ['title'],
      itemsFields: [{ key: 'blocks', itemKeys: ['title', 'body'] }],
    },
  ]);
});

/* -------------------------------------------------------------------------
 * The editor's save-time language sync — the third consumer of the rule.
 * ---------------------------------------------------------------------- */

const { createSaveManager } =
  await import('../client/views/editor/save-manager.js');

const NESTED_TYPES = {
  'text-blocks-slide': {
    fields: [
      { key: 'title', type: 'string' },
      {
        key: 'rows',
        type: 'items',
        itemFields: [
          { key: 'title', type: 'string' },
          { key: 'color', type: 'enum' },
          {
            key: 'blocks',
            type: 'items',
            itemFields: [
              { key: 'title', type: 'string' },
              { key: 'body', type: 'markdown' },
            ],
          },
        ],
      },
    ],
  },
};

test("saving keeps the other language's nested texts and blanks the rest", async () => {
  const pres = {
    id: 'p1',
    revision: 1,
    ...deck('nl'),
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: { title: 'Het plan', slides: [] },
        'en-GB': {
          title: 'The plan',
          slides: [
            {
              id: SLIDE_ID,
              type: 'text-blocks-slide',
              notes: '',
              content: {
                title: 'Approach',
                rows: [
                  {
                    title: 'Row one',
                    color: 'yellow',
                    blocks: [{ title: 'Block A', body: 'Text A' }],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  };

  const mgr = createSaveManager({
    api: async (_path, opts) => ({
      ...JSON.parse(opts.body),
      revision: Number(opts.headers['If-Match']) + 1,
      modified: 'x',
    }),
    toast: { info: () => {}, error: () => {}, success: () => {} },
    pres,
    id: pres.id,
    SLIDE_TYPES: NESTED_TYPES,
    normalizeLang: (l) => (l === 'nl' || l === 'en-GB' ? l : null),
    getSelectedSlideId: () => SLIDE_ID,
  });
  mgr.markDirty({ slideId: SLIDE_ID });
  await mgr.requestSave();
  mgr.cancelAutosave();

  const rows = pres.i18n.versions['en-GB'].slides[0].content.rows;
  assert.equal(rows.length, 2, 'row count follows the source');
  assert.equal(
    rows[0].blocks[0].title,
    'Block A',
    'an existing nested translation survives the save',
  );
  assert.equal(
    rows[0].blocks[1].title,
    '',
    'a nested text with no translation yet is blanked, not copied from source',
  );
  assert.equal(rows[1].blocks[0].body, '', 'and so is a whole new row');
  assert.equal(rows[0].color, 'yellow', 'non-text values follow the source');
});
