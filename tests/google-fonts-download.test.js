/**
 * The font download stops the install, it never skips a file (B559).
 *
 * `postinstall` used to warn and carry on when `fonts.gstatic.com` did not
 * answer, on the premise that the fonts were optional at runtime. They are not:
 * the theme seeds refuse a curated face that is missing on disk, so one CI
 * time-out surfaced minutes later as a red `test-postgres` blaming
 * `themes/amethyst.json`. Now a request that gets no answer is retried, and when
 * every attempt fails the error carries the network cause out of the install.
 *
 * These tests stub `fetch`; nothing here touches the network or the font dir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchBytes } from '../scripts/download-google-fonts.js';

const URL = 'https://fonts.gstatic.com/s/inter/v20/test.woff2';
const FAST = { backoffMs: 0 };

/** Replace `fetch` with a scripted sequence for one test; returns the call log. */
function stubFetch(t, ...steps) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    const step = steps[Math.min(calls.length, steps.length) - 1];
    if (step instanceof Error) throw step;
    return step;
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

const networkError = () =>
  Object.assign(new TypeError('fetch failed'), {
    cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
  });

// Retries print a line each; keep the test output clean.
test.beforeEach((t) => t.mock.method(console, 'error', () => {}));

test('a request that gets no answer once is retried and succeeds', async (t) => {
  const calls = stubFetch(t, networkError(), new Response('woff2-bytes'));
  const bytes = await fetchBytes(URL, FAST);
  assert.equal(bytes.toString(), 'woff2-bytes');
  assert.equal(calls.length, 2);
});

test('a body that breaks off mid-stream is retried like a lost request', async (t) => {
  const broken = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(networkError());
      },
    }),
  );
  const calls = stubFetch(t, broken, new Response('woff2-bytes'));
  const bytes = await fetchBytes(URL, FAST);
  assert.equal(bytes.toString(), 'woff2-bytes');
  assert.equal(calls.length, 2);
});

test('a network failure on every attempt rejects with the network cause', async (t) => {
  const calls = stubFetch(t, networkError());
  await assert.rejects(fetchBytes(URL, FAST), (err) => {
    assert.match(err.message, /could not reach .*UND_ERR_CONNECT_TIMEOUT/);
    assert.match(err.message, /after 3 attempts/);
    assert.match(err.message, /not a broken pin/);
    return true;
  });
  assert.equal(calls.length, 3);
});

test('an HTTP error is a broken pin: no retry, points at --update-lock', async (t) => {
  const calls = stubFetch(
    t,
    new Response('gone', { status: 404, statusText: 'Not Found' }),
  );
  await assert.rejects(
    fetchBytes(URL, FAST),
    /404 Not Found[\s\S]*--update-lock/,
  );
  assert.equal(calls.length, 1);
});
