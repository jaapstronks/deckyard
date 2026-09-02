import test from 'node:test';
import assert from 'node:assert/strict';

import { transformOpenAiCompatibleRequest } from '../server/utils/llm/provider-base.js';
import { requestChatCompletionContent } from '../server/utils/llm/index.js';

const build = (params) =>
  transformOpenAiCompatibleRequest({ messages: [], ...params });

test('a caller budget reaches the OpenAI-compatible wire body', () => {
  // The whole point of B214: twenty call sites pass a budget between 512 and
  // 16000, and it used to be dropped before JSON.stringify ever saw it.
  const body = build({ model: 'mistral-large-latest', maxTokens: 8192 });
  assert.equal(body.max_tokens, 8192);
});

test('the budget field is named per model contract, never both', () => {
  for (const model of [
    'gpt-5',
    'gpt-5.2',
    'gpt-5.5',
    'gpt-6',
    'gpt-10',
    'o3',
  ]) {
    const body = build({ model, maxTokens: 4096 });
    assert.equal(
      body.max_completion_tokens,
      4096,
      `${model} must receive max_completion_tokens`,
    );
    assert.ok(!('max_tokens' in body), `${model} must not receive max_tokens`);
  }

  for (const model of [
    'gpt-4o',
    'mistral-large-latest',
    'deepseek-chat',
    'llama3.1:8b',
  ]) {
    const body = build({ model, maxTokens: 4096 });
    assert.equal(body.max_tokens, 4096, `${model} must receive max_tokens`);
    assert.ok(
      !('max_completion_tokens' in body),
      `${model} must not receive max_completion_tokens`,
    );
  }
});

test('no budget means no budget field, so the model default applies', () => {
  for (const maxTokens of [undefined, null, 0, -1, 'nope', NaN]) {
    const body = build({ model: 'gpt-4o', maxTokens });
    assert.ok(
      !('max_tokens' in body) && !('max_completion_tokens' in body),
      `maxTokens=${String(maxTokens)} must not produce a budget field`,
    );
  }
});

test('the Claude transform keeps its own max_tokens spelling', async () => {
  const seen = await captureRequestBody({
    vendor: 'claude',
    model: 'claude-sonnet-5',
    maxTokens: 2048,
  });
  assert.equal(seen.max_tokens, 2048);
  assert.ok(!('max_completion_tokens' in seen));
});

test('requestChatCompletionContent forwards the budget to every vendor', async () => {
  const cases = [
    ['openai', 'gpt-5.5', 'max_completion_tokens'],
    ['mistral', 'mistral-large-latest', 'max_tokens'],
    ['deepseek', 'deepseek-chat', 'max_tokens'],
    ['openai-compat', 'llama3.1:8b', 'max_tokens'],
  ];

  for (const [vendor, model, field] of cases) {
    const seen = await captureRequestBody({ vendor, model, maxTokens: 512 });
    assert.equal(seen[field], 512, `${vendor} must send ${field}`);
  }
});

/**
 * Run one `requestChatCompletionContent` call against a stubbed fetch and
 * return the parsed request body that would have gone over the wire.
 *
 * @param {Object} params - vendor/model/maxTokens for the call
 * @returns {Promise<Object>} Parsed request body
 */
async function captureRequestBody(params) {
  const savedFetch = globalThis.fetch;
  const savedEndpoint = process.env.OPENAI_COMPAT_ENDPOINT;
  process.env.OPENAI_COMPAT_ENDPOINT = 'http://127.0.0.1:1/v1/chat/completions';

  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => '{}' };
  };

  try {
    await requestChatCompletionContent({
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hi' }],
      ...params,
    });
  } finally {
    globalThis.fetch = savedFetch;
    if (savedEndpoint === undefined) delete process.env.OPENAI_COMPAT_ENDPOINT;
    else process.env.OPENAI_COMPAT_ENDPOINT = savedEndpoint;
  }

  return body;
}
