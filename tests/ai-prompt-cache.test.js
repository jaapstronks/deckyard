/**
 * Phase 2 sends its fixed prompt as a cached prefix (B766).
 *
 * The rules and the type catalog are most of every refine call's input. They
 * only cache when they are byte-identical across the groups of a deck, so the
 * per-group parts (adjacent context, presentation context) live in the user
 * message. The first group runs alone so the rest can read the cache it wrote.
 *
 * Run with: node --test tests/ai-prompt-cache.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { refineAllSlideGroups } from '../server/utils/ai/refine-slides.js';
import { requestChatCompletionContent } from '../server/utils/llm/index.js';
import { transformOpenAiCompatibleRequest } from '../server/utils/llm/provider-base.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

/** A Claude Messages reply refining the slides named in the request. */
function claudeReply(body) {
  const indexes = [
    ...body.messages[0].content.matchAll(/originalIndex: (\d+)\)/g),
  ].map((m) => Number(m[1]));
  const slides = indexes.map((originalIndex) => ({
    originalIndex,
    type: 'content-slide',
    content: { title: `Slide ${originalIndex}`, body: 'One short line.' },
  }));
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ slides }) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Groups as `groupSlidesForPhase2()` makes them, one slide each. */
function groups(count) {
  return Array.from({ length: count }, (_, index) => ({
    groupId: `g${index}`,
    slides: [
      {
        index,
        intent: 'content',
        hints: index % 2 ? ['list'] : ['comparison'],
        roughContent: `Rough content of slide ${index}.`,
      },
    ],
  }));
}

/** Run phase 2 against a fake Claude and return every request body. */
async function refineWithClaude(t, groupCount, { onRequest } = {}) {
  const bodies = [];
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    await onRequest?.(body);
    return claudeReply(body);
  });
  const saved = process.env.CLAUDE_API;
  process.env.CLAUDE_API = 'offline-test';
  try {
    await refineAllSlideGroups(groups(groupCount), {
      lang: 'en',
      vendor: 'claude',
      batchSize: 6,
      presentationContext: { title: 'Deck title', summary: 'What it says.' },
      themeContext: { slideBackgrounds: [] },
      slideTypes: SLIDE_TYPES,
    });
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_API;
    else process.env.CLAUDE_API = saved;
  }
  return bodies;
}

test('the system prompt is byte-identical over the groups of one deck', async (t) => {
  const bodies = await refineWithClaude(t, 8);
  assert.equal(bodies.length, 8);
  const systems = bodies.map((body) => JSON.stringify(body.system));
  for (const system of systems) assert.equal(system, systems[0]);

  // The per-group parts did not disappear: they moved to the user message.
  const users = bodies.map((body) => body.messages[0].content);
  assert.ok(users.every((user) => user.includes('Title: Deck title')));
  assert.ok(users.slice(1).every((user) => user.includes('ADJACENT CONTEXT')));
  assert.ok(!systems[0].includes('Deck title'));
  assert.ok(!systems[0].includes('ADJACENT CONTEXT'));
});

test('the system prompt carries the cache breakpoint', async (t) => {
  const [body] = await refineWithClaude(t, 1);
  assert.ok(Array.isArray(body.system), 'block form');
  assert.equal(body.system.length, 1);
  assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
  assert.match(body.system[0].text, /slide type selector/);
});

test('the first group runs alone before the rest fan out', async (t) => {
  let inFlight = 0;
  const concurrency = [];
  await refineWithClaude(t, 7, {
    onRequest: async () => {
      inFlight += 1;
      concurrency.push(inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
    },
  });
  assert.equal(concurrency[0], 1, 'the first call starts alone');
  assert.equal(concurrency[1], 1, 'the second starts after the first is done');
  assert.equal(Math.max(...concurrency), 6, 'the rest fan out per batch');
});

test('an unmarked prompt keeps the plain system string', async (t) => {
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    body = JSON.parse(init.body);
    return claudeReply({ messages: [{ content: '' }] });
  });
  await requestChatCompletionContent({
    vendor: 'claude',
    apiKey: 'offline-test',
    model: 'claude-opus-5',
    messages: [
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Question.' },
    ],
  });
  assert.equal(body.system, 'Rules.');
  assert.equal(body.messages[0].content, 'Question.');
});

test('OpenAI-compatible vendors get the same messages without the marker', () => {
  const body = transformOpenAiCompatibleRequest({
    model: 'gpt-5.5',
    messages: [
      { role: 'system', content: 'Rules.', cache: true },
      { role: 'user', content: 'Question.' },
    ],
  });
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Rules.' },
    { role: 'user', content: 'Question.' },
  ]);
});
