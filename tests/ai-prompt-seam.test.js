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

import {
  resolvePrompts,
  prompts,
  BASE_PROMPT_NAMES,
} from '../server/utils/ai/prompts/index.js';
import { loadCustomPromptOverrides } from '../server/utils/ai/prompts/custom-loader.js';

const baseStub = {
  buildAnalysisSystemPrompt: () => 'base-outline',
  buildRevisionSystemPrompt: () => 'base-revision',
};

test('resolvePrompts: a function override for a known builder wins', () => {
  const r = resolvePrompts(baseStub, {
    buildAnalysisSystemPrompt: () => 'custom-outline',
  });
  assert.equal(r.buildAnalysisSystemPrompt(), 'custom-outline');
  assert.equal(
    r.buildRevisionSystemPrompt(),
    'base-revision',
    'un-overridden builder keeps base',
  );
});

test('resolvePrompts: non-functions and unknown keys are ignored', () => {
  const r = resolvePrompts(baseStub, {
    buildRevisionSystemPrompt: 'not-a-function',
    somethingElse: () => 'nope',
  });
  assert.equal(
    r.buildRevisionSystemPrompt(),
    'base-revision',
    'non-function override rejected',
  );
  assert.ok(!('somethingElse' in r), 'unknown builder key not added');
});

test('resolvePrompts: no overrides returns the base builders', () => {
  const r = resolvePrompts(baseStub);
  assert.equal(r.buildAnalysisSystemPrompt(), 'base-outline');
  assert.equal(r.buildRevisionSystemPrompt(), 'base-revision');
});

test('shipped prompts object exposes every base builder as a function', () => {
  assert.ok(BASE_PROMPT_NAMES.includes('buildAnalysisSystemPrompt'));
  assert.ok(BASE_PROMPT_NAMES.includes('buildStructureSystemPrompt'));
  assert.ok(BASE_PROMPT_NAMES.includes('buildPhase2SystemPrompt'));
  assert.ok(BASE_PROMPT_NAMES.includes('buildSectionSystemPrompt'));
  for (const name of BASE_PROMPT_NAMES) {
    assert.equal(
      typeof prompts[name],
      'function',
      `${name} should resolve to a function`,
    );
  }
  // `buildThemeContextSection` is a module-local helper of buildPhase2SystemPrompt,
  // not routed through the registry — advertising it would accept a fork override
  // that never fires, so it must stay out of the override set.
  assert.ok(
    !BASE_PROMPT_NAMES.includes('buildThemeContextSection'),
    'buildThemeContextSection must not be advertised as an override name',
  );
});

test('base outline builders produce their copy and honour the language label', () => {
  const analysis = prompts.buildAnalysisSystemPrompt({
    detectedLang: { label: 'ENGLISH' },
    requestedLang: 'nl',
  });
  assert.match(analysis, /You analyse a source document/);
  assert.match(analysis, /OUTPUT LANGUAGE: DUTCH/, 'requestedLang nl -> DUTCH');

  const structure = prompts.buildStructureSystemPrompt({
    detectedLang: { label: 'ENGLISH' },
    requestedLang: null,
    targetSlides: 7,
  });
  assert.match(structure, /OUTPUT LANGUAGE: ENGLISH/, 'falls back to detected');
  assert.match(structure, /Budget: about 7 slides in the finished deck/);
  assert.match(structure, /Plan at most 6 slides here/);
});

test('loadCustomPromptOverrides: absent file resolves to an empty map', async () => {
  const none = await loadCustomPromptOverrides({
    file: '/no/such/custom/ai/prompts.js',
  });
  assert.deepEqual(none, {});
});

test('loadCustomPromptOverrides: loads a fork file, filtered to known builders', async () => {
  const file = fileURLToPath(
    new URL('./fixtures/custom-ai-prompts.fixture.js', import.meta.url),
  );
  const loaded = await loadCustomPromptOverrides({
    file,
    knownBuilders: new Set(BASE_PROMPT_NAMES),
  });
  assert.deepEqual(
    Object.keys(loaded),
    ['buildAnalysisSystemPrompt'],
    'only the valid known override survives',
  );
  assert.equal(loaded.buildAnalysisSystemPrompt(), 'CUSTOM_OUTLINE_PROMPT');

  // And it wins when resolved against the real base.
  const resolved = resolvePrompts(prompts, loaded);
  assert.equal(resolved.buildAnalysisSystemPrompt(), 'CUSTOM_OUTLINE_PROMPT');
});
