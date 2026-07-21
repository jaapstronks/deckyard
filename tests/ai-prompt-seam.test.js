/**
 * OSS prompt-content seam: base-then-overlay resolver + custom/ai/ loader.
 *
 * Covers the seam's contract without hitting an LLM:
 *  - resolvePrompts merges fork overrides onto the base (custom wins), and
 *    ignores non-functions and unknown keys.
 *  - the shipped `prompts` object exposes every base builder as a function and
 *    still produces the base copy out of the box (no override present in OSS).
 *  - loadCustomPromptOverrides loads a fork file, filters to known builders,
 *    and stays silent-and-empty when the file is absent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { resolvePrompts, prompts, BASE_PROMPT_NAMES } from '../server/utils/ai/prompts/index.js';
import { loadCustomPromptOverrides } from '../server/utils/ai/prompts/custom-loader.js';

const baseStub = {
  buildPhase1SystemPrompt: () => 'base-outline',
  buildRevisionSystemPrompt: () => 'base-revision',
};

test('resolvePrompts: a function override for a known builder wins', () => {
  const r = resolvePrompts(baseStub, { buildPhase1SystemPrompt: () => 'custom-outline' });
  assert.equal(r.buildPhase1SystemPrompt(), 'custom-outline');
  assert.equal(r.buildRevisionSystemPrompt(), 'base-revision', 'un-overridden builder keeps base');
});

test('resolvePrompts: non-functions and unknown keys are ignored', () => {
  const r = resolvePrompts(baseStub, {
    buildRevisionSystemPrompt: 'not-a-function',
    somethingElse: () => 'nope',
  });
  assert.equal(r.buildRevisionSystemPrompt(), 'base-revision', 'non-function override rejected');
  assert.ok(!('somethingElse' in r), 'unknown builder key not added');
});

test('resolvePrompts: no overrides returns the base builders', () => {
  const r = resolvePrompts(baseStub);
  assert.equal(r.buildPhase1SystemPrompt(), 'base-outline');
  assert.equal(r.buildRevisionSystemPrompt(), 'base-revision');
});

test('shipped prompts object exposes every base builder as a function', () => {
  assert.ok(BASE_PROMPT_NAMES.includes('buildPhase1SystemPrompt'));
  assert.ok(BASE_PROMPT_NAMES.includes('buildPhase2SystemPrompt'));
  assert.ok(BASE_PROMPT_NAMES.includes('buildSectionSystemPrompt'));
  for (const name of BASE_PROMPT_NAMES) {
    assert.equal(typeof prompts[name], 'function', `${name} should resolve to a function`);
  }
});

test('base outline builder produces its copy and honours the language label', () => {
  const out = prompts.buildPhase1SystemPrompt({
    detectedLang: { label: 'ENGLISH' },
    requestedLang: 'nl',
    targetSlides: 7,
    estimatedInputLines: 30,
  });
  assert.match(out, /presentation outline generator/);
  assert.match(out, /OUTPUT LANGUAGE: DUTCH/, 'requestedLang nl -> DUTCH');
  assert.match(out, /Target: 7 content slides/);
});

test('loadCustomPromptOverrides: absent file resolves to an empty map', async () => {
  const none = await loadCustomPromptOverrides({ file: '/no/such/custom/ai/prompts.js' });
  assert.deepEqual(none, {});
});

test('loadCustomPromptOverrides: loads a fork file, filtered to known builders', async () => {
  const file = fileURLToPath(new URL('./fixtures/custom-ai-prompts.fixture.js', import.meta.url));
  const loaded = await loadCustomPromptOverrides({
    file,
    knownBuilders: new Set(BASE_PROMPT_NAMES),
  });
  assert.deepEqual(Object.keys(loaded), ['buildPhase1SystemPrompt'], 'only the valid known override survives');
  assert.equal(loaded.buildPhase1SystemPrompt(), 'CUSTOM_OUTLINE_PROMPT');

  // And it wins when resolved against the real base.
  const resolved = resolvePrompts(prompts, loaded);
  assert.equal(resolved.buildPhase1SystemPrompt(), 'CUSTOM_OUTLINE_PROMPT');
});
