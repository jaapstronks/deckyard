import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import {
  assertSlideTextLengths,
  SlideTextLengthError,
  validateAndFixRefinedSlides,
} from '../server/utils/ai/validate-slides/index.js';
import { refineSlideGroup } from '../server/utils/ai/refine-slides.js';
import { separateSlidesForProcessing } from '../server/utils/ai/generate-outline.js';
import { buildPhase2SystemPrompt } from '../server/utils/ai/prompts/base/refine-slides.js';

const cap = SLIDE_TYPES['content-slide'].fields.find(
  (f) => f.key === 'body',
).maxLength;
const original = {
  index: 0,
  intent: 'content',
  hints: [],
  roughContent: 'A complete source sentence.',
};
const group = { groupId: 'g', slides: [original] };
const response = (body) => ({
  slides: [
    {
      originalIndex: 0,
      type: 'content-slide',
      content: { title: 'Title', body },
    },
  ],
});

async function withReplies(t, replies, run) {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    const reply = replies.shift();
    assert.ok(reply, 'no unplanned provider call');
    requests.push(request);
    if (reply instanceof Error) throw reply;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(reply) } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  const requests = [];
  const saved = process.env.OPENAI_API;
  process.env.OPENAI_API = 'offline-test';
  try {
    await run(requests);
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API;
    else process.env.OPENAI_API = saved;
  }
}

test('validation refuses overlong text without modifying it; boundary remains unchanged', () => {
  const input = response('x'.repeat(cap + 1)).slides;
  assert.throws(() => validateAndFixRefinedSlides(input), SlideTextLengthError);
  assert.equal(input[0].content.body.length, cap + 1);
  const [valid] = validateAndFixRefinedSlides(response('x'.repeat(cap)).slides);
  assert.equal(valid.content.body, 'x'.repeat(cap));
});

test('nested collection lengths are refused with their complete field path', () => {
  const def = {
    fields: [
      {
        key: 'rows',
        type: 'items',
        itemFields: [
          {
            key: 'blocks',
            type: 'items',
            itemFields: [{ key: 'text', type: 'markdown', maxLength: 8 }],
          },
        ],
      },
    ],
  };
  assert.throws(
    () =>
      assertSlideTextLengths(
        {
          originalIndex: 3,
          type: 'nested',
          content: { rows: [{ blocks: [{ text: 'too long text' }] }] },
        },
        def,
      ),
    (err) => {
      assert.equal(err.details[0].field, 'rows.0.blocks.0.text');
      assert.equal(err.details[0].expected, 'maxLength 8');
      return true;
    },
  );
});

test('refinement sends the rejected response and exact violation to the model for rewriting', async (t) => {
  await withReplies(
    t,
    [response('x'.repeat(cap + 1)), response('A complete short sentence.')],
    async (requests) => {
      const slides = await refineSlideGroup(group, { vendor: 'openai' });
      assert.equal(slides[0].content.body, 'A complete short sentence.');
      assert.equal(requests.length, 2);
      assert.equal(requests[1].messages.at(-2).role, 'assistant');
      assert.match(
        requests[1].messages.at(-1).content,
        new RegExp(`${cap + 1} > ${cap}`),
      );
    },
  );
});

test('exhausted length repair rejects rather than returning a fallback', async (t) => {
  await withReplies(
    t,
    [response('x'.repeat(cap + 1)), response('x'.repeat(cap + 2))],
    async (requests) => {
      await assert.rejects(
        refineSlideGroup(group, { vendor: 'openai' }),
        SlideTextLengthError,
      );
      assert.equal(requests.length, 2);
    },
  );
});

test('a malformed repair cannot evade the earlier length refusal', async (t) => {
  await withReplies(t, [response('x'.repeat(cap + 1)), {}], async () => {
    await assert.rejects(
      refineSlideGroup(group, { vendor: 'openai' }),
      SlideTextLengthError,
    );
  });
});

for (const [label, type, content] of [
  ['empty content', 'content-slide', {}],
  ['missing content', 'content-slide', undefined],
  ['null content', 'content-slide', null],
  ['missing title', 'content-slide', { body: 'Complete sentence.' }],
  ['missing body', 'content-slide', { title: 'Title' }],
  ['wrong title type', 'content-slide', { title: 42, body: 'Sentence.' }],
  ['wrong body type', 'content-slide', { title: 'Title', body: [] }],
  ['blank required text', 'content-slide', { title: ' ', body: 'Sentence.' }],
  [
    'invalid nested blocks',
    'text-blocks-slide',
    { title: 'Title', rows: [{ blocks: 'invalid' }] },
  ],
  [
    'invalid nested text',
    'text-blocks-slide',
    { title: 'Title', rows: [{ blocks: [{ title: 'Block', body: 42 }] }] },
  ],
]) {
  test(`length rewrite refuses ${label} without fallback`, async (t) => {
    const repair = { slides: [{ originalIndex: 0, type, content }] };
    await withReplies(
      t,
      [response('x'.repeat(cap + 1)), repair],
      async (requests) => {
        await assert.rejects(
          refineSlideGroup(group, { vendor: 'openai' }),
          SlideTextLengthError,
        );
        assert.equal(requests.length, 2);
      },
    );
  });
}

test('overlong structural slides go to refinement intact', () => {
  const slides = ['quote', 'chapter'].map((intent, index) => ({
    ...original,
    intent,
    index,
    roughContent: 'x'.repeat(2000),
  }));
  const separated = separateSlidesForProcessing(slides);
  assert.equal(separated.structuralSlides.length, 0);
  assert.equal(separated.contentGroups.length, 2);
  for (const entry of separated.contentGroups)
    assert.equal(entry.slides[0].roughContent.length, 2000);
});

test('prompt describes the declared lengths and refusal policy', () => {
  const prompt = buildPhase2SystemPrompt({
    lang: 'en',
    disabledSlideTypes: [],
    customSlideTypes: [],
  });
  assert.match(prompt, new RegExp(`body: ${cap}`));
  assert.match(prompt, /rows\[\]\.blocks\[\]\./);
  assert.match(prompt, /rejected and must be rewritten/);
  assert.doesNotMatch(prompt, /will be truncated/);
});

test('closing copy with no declared cap is preserved instead of sliced', () => {
  const text = 'A complete closing sentence. '.repeat(10);
  const { structuralSlides } = separateSlidesForProcessing([
    { ...original, intent: 'closing', roughContent: text },
  ]);
  assert.equal(structuralSlides[0].content.tagline, text);
});

test('a repair cannot drop the rejected slide and trigger a fallback', async (t) => {
  const other = { ...original, index: 1 };
  await withReplies(
    t,
    [
      response('x'.repeat(cap + 1)),
      {
        slides: [
          {
            originalIndex: 1,
            type: 'content-slide',
            content: { title: 'Other' },
          },
        ],
      },
    ],
    async () => {
      await assert.rejects(
        refineSlideGroup(
          { groupId: 'g', slides: [original, other] },
          { vendor: 'openai' },
        ),
        SlideTextLengthError,
      );
    },
  );
});

test('all eight clipped suite field paths refuse oversize copy without clipping', () => {
  const examples = JSON.parse(
    readFileSync(
      new URL('./fixtures/ai-clipped-suite-fields.json', import.meta.url),
    ),
  );
  assert.equal(examples.length, 8);
  for (const example of examples) {
    const content = {};
    let parent = content;
    for (let i = 0; i < example.path.length - 1; i++) {
      const key = example.path[i];
      parent[key] = typeof example.path[i + 1] === 'number' ? [] : {};
      parent = parent[key];
    }
    const text = example.clippedText.replace(/\.\.\.$/, '').repeat(100);
    parent[example.path.at(-1)] = text;
    const slide = { type: example.type, content };
    assert.throws(
      () => assertSlideTextLengths(slide, SLIDE_TYPES[example.type]),
      SlideTextLengthError,
      `${example.run}/${example.caseId}/${example.path.join('.')}`,
    );
    assert.equal(parent[example.path.at(-1)], text);
  }
});
