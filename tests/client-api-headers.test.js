/**
 * `api()` merges the caller's headers into its JSON default instead of
 * replacing the whole set (B341). Before the fix `...opts` was spread after
 * the merged `headers`, so any caller that sent its own header (`If-Match`
 * on the library PATCH, for one) silently lost `Content-Type`.
 *
 * Run with: node --test tests/client-api-headers.test.js
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert';

import { api, requestHeaders } from '../client/lib/api.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub fetch, run one `api()` call, return the init it was given. */
async function sentInit(opts) {
  let init = null;
  globalThis.fetch = async (_path, i) => {
    init = i;
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  await api('/api/x', opts);
  return init;
}

test('without own headers the JSON default is sent', async () => {
  const init = await sentInit({ method: 'POST', body: { a: 1 } });
  assert.strictEqual(init.headers.get('content-type'), 'application/json');
  assert.strictEqual(init.body, '{"a":1}');
});

test('an own header keeps the Content-Type default', async () => {
  const init = await sentInit({
    method: 'PATCH',
    headers: { 'If-Match': '3' },
    body: { name: 'x' },
  });
  assert.strictEqual(init.headers.get('if-match'), '3');
  assert.strictEqual(init.headers.get('content-type'), 'application/json');
});

test('an explicit Content-Type wins over the default, in any spelling', () => {
  for (const name of ['Content-Type', 'content-type', 'CONTENT-TYPE']) {
    const h = requestHeaders({ [name]: 'application/x-deckyard' });
    assert.strictEqual(h.get('content-type'), 'application/x-deckyard');
    assert.deepStrictEqual([...h.keys()], ['content-type']);
  }
});

test('headers given as a Headers instance or entry list merge the same way', () => {
  const fromHeaders = requestHeaders(new Headers({ 'If-Match': '7' }));
  const fromEntries = requestHeaders([['If-Match', '7']]);
  for (const h of [fromHeaders, fromEntries]) {
    assert.strictEqual(h.get('if-match'), '7');
    assert.strictEqual(h.get('content-type'), 'application/json');
  }
});
