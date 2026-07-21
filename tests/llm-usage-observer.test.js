import test from 'node:test';
import assert from 'node:assert/strict';

import { subscribeLlmUsage, emitLlmUsage, normalizeUsage } from '../server/utils/llm/usage.js';

test('normalizeUsage maps Claude usage fields', () => {
  const usage = normalizeUsage({
    input_tokens: 120,
    output_tokens: 45,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: 30,
  });
  assert.deepEqual(usage, {
    inputTokens: 120,
    outputTokens: 45,
    cacheReadTokens: 900,
    cacheWriteTokens: 30,
  });
});

test('normalizeUsage defaults missing and invalid counts to zero', () => {
  assert.deepEqual(normalizeUsage(undefined), {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.equal(normalizeUsage({ input_tokens: 'nope' }).inputTokens, 0);
  assert.equal(normalizeUsage({ output_tokens: -5 }).outputTokens, 0);
});

test('subscribers receive emitted usage events until they unsubscribe', () => {
  const seen = [];
  const unsubscribe = subscribeLlmUsage((event) => seen.push(event));

  emitLlmUsage({ vendor: 'claude', model: 'claude-opus-4-8', inputTokens: 10, outputTokens: 2 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, 'claude-opus-4-8');

  unsubscribe();
  emitLlmUsage({ vendor: 'claude', model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 1 });
  assert.equal(seen.length, 1, 'no events after unsubscribe');
});

test('a throwing listener does not break the emitter or other listeners', () => {
  const seen = [];
  const unsubA = subscribeLlmUsage(() => {
    throw new Error('listener blew up');
  });
  const unsubB = subscribeLlmUsage((event) => seen.push(event));

  assert.doesNotThrow(() => emitLlmUsage({ vendor: 'claude', model: 'm', inputTokens: 1 }));
  assert.equal(seen.length, 1, 'healthy listener still ran');

  unsubA();
  unsubB();
});
