/**
 * `serverSentence(err)` returns the envelope's `message` and nothing else, so
 * a form with translated copy of its own shows that copy when the failure has
 * no server sentence (B859). Before, the password forms read `err.message`,
 * which `api()` never leaves empty: an HTTP failure without a `message` read
 * "Request failed (500)" and a network error "Failed to fetch", in English in
 * every locale.
 *
 * Run with: node --test tests/client-api-server-sentence.test.js
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert';

import { api, serverSentence } from '../client/lib/api.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Run one `api()` call against a stubbed fetch and return what it threw. */
async function caught(respond) {
  globalThis.fetch = async () => respond();
  try {
    await api('/api/auth/forgot-password', { method: 'POST', body: {} });
  } catch (err) {
    return err;
  }
  assert.fail('api() resolved');
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test('the envelope message is the server sentence', async () => {
  const err = await caught(() =>
    json(400, {
      ok: false,
      error: 'invalid_token',
      message: 'Deze link is verlopen.',
    }),
  );
  assert.equal(serverSentence(err), 'Deze link is verlopen.');
});

test('an HTTP failure without a message has none, though err.message is set', async () => {
  const err = await caught(() => json(500, { ok: false, error: 'internal' }));
  assert.equal(serverSentence(err), null);
  assert.ok(err.message, 'api() still fills err.message');
});

test('a blank message, a non-JSON body and a network error have none', async () => {
  const blank = await caught(() =>
    json(500, { ok: false, error: 'internal', message: '  ' }),
  );
  assert.equal(serverSentence(blank), null);
  const html = await caught(
    () =>
      new Response('<h1>Bad gateway</h1>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
  );
  assert.equal(serverSentence(html), null);
  const network = await caught(() => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(serverSentence(network), null);
  assert.equal(serverSentence(undefined), null);
});
