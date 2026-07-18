import test from 'node:test';
import assert from 'node:assert/strict';

import { transformOpenAiCompatibleRequest } from '../server/utils/llm/provider-base.js';

const build = (model) =>
  transformOpenAiCompatibleRequest({ model, temperature: 0.3, messages: [] });

test('temperature is omitted for models that reject a non-default value', () => {
  // gpt-5.5 answers a non-default temperature with 400 unsupported_value,
  // which fails the request outright rather than degrading.
  for (const model of ['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6', 'o3']) {
    assert.ok(
      !('temperature' in build(model)),
      `${model} must not receive a temperature`
    );
  }
});

test('temperature is still sent to models that accept it', () => {
  // Kept for older models so existing deployments do not silently change
  // sampling behaviour.
  for (const model of ['gpt-5.2', 'gpt-5.1', 'gpt-4o', 'mistral-large-latest']) {
    assert.equal(build(model).temperature, 0.3, `${model} should keep its temperature`);
  }
});

test('response_format is passed through only when provided', () => {
  const withFormat = transformOpenAiCompatibleRequest({
    model: 'gpt-5.5',
    responseFormat: { type: 'json_object' },
    messages: [],
  });
  assert.deepEqual(withFormat.response_format, { type: 'json_object' });
  assert.ok(!('response_format' in build('gpt-5.5')));
});
