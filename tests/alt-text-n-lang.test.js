/**
 * B182 fase 5 — AI alt text is generated for the languages the caller names.
 *
 * The image library's alt panel renders one input per enabled deck language
 * (D72 #5). Its "generate" button used to reach a generator that asked the
 * model for exactly `nl` and `en-GB`, so a workspace running German or French
 * got empty fields back from a button that reported success — the bilingual
 * assumption moved to the server rather than being removed.
 *
 * These tests pin the contract the widened generator answers: the request names
 * its languages, the prompt asks for exactly those keys, and the response
 * carries exactly those keys.
 *
 * The AI seam is mocked at `globalThis.fetch`, the same edge
 * `tests/digest-generation.test.js` uses, so no key and no network are needed.
 *
 * Run with: node --test tests/alt-text-n-lang.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SUPPORTED_DECK_LANGS } from '../shared/i18n-utils.js';

// Pin the LLM vendor so getLlmConfig resolves without a real key or network.
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';

/** The JSON string the fake model "returns", and the request it last saw. */
let aiResponse = '{}';
let lastRequest = null;

const realFetch = globalThis.fetch;
globalThis.fetch = async (endpoint, opts) => {
  lastRequest = opts?.body ? JSON.parse(opts.body) : null;
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

const { generateImageAltTexts } =
  await import('../server/utils/llm/alt-text.js');

/** The system prompt the generator built for the last call. */
const systemPrompt = () =>
  lastRequest?.messages?.find((m) => m.role === 'system')?.content || '';

async function generate({ langs, model = {} } = {}) {
  aiResponse = JSON.stringify(model);
  lastRequest = null;
  return generateImageAltTexts({
    imageUrl: 'https://example.test/photo.jpg',
    langs,
    vendor: 'openai',
  });
}

test('the caller names the languages, and gets exactly those back', async () => {
  const out = await generate({
    langs: ['nl', 'de', 'fr'],
    model: {
      nl: 'Zonsondergang boven het meer',
      de: 'Sonnenuntergang über dem See',
      fr: 'Coucher de soleil sur le lac',
      // A language nobody asked for is not smuggled into the map.
      'en-GB': 'Sunset over the lake',
    },
  });

  assert.deepEqual(Object.keys(out.alts), ['nl', 'de', 'fr']);
  assert.equal(out.alts.de, 'Sonnenuntergang über dem See');
  assert.deepEqual(out.langs, ['nl', 'de', 'fr']);
});

test('the prompt asks for the requested keys and names their languages', async () => {
  await generate({ langs: ['fi', 'pl'] });
  const system = systemPrompt();

  assert.match(system, /\{ "fi": "<alt text>", "pl": "<alt text>" \}/);
  assert.match(system, /natural Finnish for "fi"/);
  assert.match(system, /natural Polish for "pl"/);
  assert.ok(
    !system.includes('"en-GB"'),
    'a language the caller did not ask for has no business in the prompt',
  );
});

test('a language the model skipped is an empty string, not a missing key', async () => {
  const out = await generate({
    langs: ['nl', 'de'],
    model: { nl: 'Een foto van een meer' },
  });

  assert.deepEqual(out.alts, { nl: 'Een foto van een meer', de: '' });
});

test('off-axis codes are dropped and aliases normalize', async () => {
  const out = await generate({
    langs: ['en', 'klingon', 'de', 'de'],
    model: { 'en-GB': 'Sunset', de: 'Sonnenuntergang' },
  });

  assert.deepEqual(out.langs, ['en-GB', 'de']);
  assert.deepEqual(out.alts, { 'en-GB': 'Sunset', de: 'Sonnenuntergang' });
});

test('naming no language falls back to the shipped subset', async () => {
  const out = await generate({ model: { nl: 'Meer', 'en-GB': 'Lake' } });

  assert.deepEqual(out.langs, [...DEFAULT_SUPPORTED_DECK_LANGS]);
});
