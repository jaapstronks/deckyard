/**
 * clientDisconnectSignal() — the one source of "the client went away" for a
 * handler (B397). `openSseStream` hands out the same signal; its stream-side
 * cases live in `tests/sse-open-stream.test.js`. These pin the plain-response
 * shape (a JSON POST that answers once, at the end) over a real socket, plus
 * the client that left before anyone listened.
 *
 * Run with: node --test tests/client-disconnect.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { clientDisconnectSignal } from '../server/utils/client-disconnect.js';

/** A server whose handler is `handler`, torn down after the test. */
async function serve(t, handler) {
  const server = http.createServer(handler);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('a JSON POST whose client leaves mid-work aborts after the body was read', async (t) => {
  let resolveSignal;
  const signalSeen = new Promise((r) => {
    resolveSignal = r;
  });
  const url = await serve(t, async (req, res) => {
    for await (const _chunk of req);
    // No stream, no write: the handler is still working when the client goes.
    resolveSignal(clientDisconnectSignal(res));
  });

  const client = new AbortController();
  const pending = fetch(url, {
    method: 'POST',
    body: '{}',
    signal: client.signal,
  }).catch(() => {});
  const signal = await signalSeen;
  assert.equal(signal.aborted, false);

  client.abort();
  await pending;
  if (!signal.aborted) await once(signal, 'abort');
  assert.equal(signal.aborted, true);
});

test('an answered request is not a cancelled one', async (t) => {
  let signal;
  const url = await serve(t, async (req, res) => {
    for await (const _chunk of req);
    signal = clientDisconnectSignal(res);
    res.end('{}');
  });

  const response = await fetch(url, { method: 'POST', body: '{}' });
  await response.text();
  // Give the server side its `close`.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(signal.aborted, false);
});

test('a client that left before anyone listened is already aborted', async (t) => {
  let resolveSignal;
  const signalSeen = new Promise((r) => {
    resolveSignal = r;
  });
  const url = await serve(t, async (req, res) => {
    for await (const _chunk of req);
    // The client is gone before the handler asks: its `close` has fired.
    await once(res, 'close');
    resolveSignal(clientDisconnectSignal(res));
  });

  const client = new AbortController();
  const pending = fetch(url, {
    method: 'POST',
    body: '{}',
    signal: client.signal,
  }).catch(() => {});
  // Let the request reach the handler, then leave.
  await new Promise((r) => setTimeout(r, 50));
  client.abort();
  await pending;

  const signal = await signalSeen;
  assert.equal(signal.aborted, true);
});
