/**
 * B404 gate — "the client left" has one spelling on the server:
 * `openSseStream({ onClose })` for a stream, `clientDisconnectSignal(res)`
 * for everything else. Both read the response.
 *
 * Three SSE routes (notifications, analytics realtime, comment events) opened
 * their stream with `openSseStream` and then hung their cleanup on
 * `req.on('close')` — a second listener for the same event, on the wrong
 * object. A GET without a body happens to close `req` when the client leaves,
 * so nothing broke; a request whose body was read closes `req` right then
 * (B397), and the same pattern on a POST stream would clean up at once.
 *
 * Nothing under `server/` may listen for `close` on `req`. The allowlist is
 * deliberately empty — a new entry means the second spelling came back.
 *
 * Run with: node --test tests/sse-onclose-guard.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** Recursively collect .js files under a directory. */
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/** A `close` listener on the request: `req.on('close'`, `.once`, `.addListener`. */
const REQ_CLOSE = /\breq\??\.(?:on|once|addListener)\(\s*['"`]close['"`]/;

test('nothing under server/ listens for close on req', () => {
  const offenders = [];
  for (const file of jsFiles(path.join(repoRoot, 'server'))) {
    const src = readFileSync(file, 'utf8');
    if (REQ_CLOSE.test(src)) offenders.push(path.relative(repoRoot, file));
  }
  assert.deepEqual(
    offenders,
    [],
    'Give stream cleanup to openSseStream({ onClose }), or read ' +
      'clientDisconnectSignal(res) — not req.on("close").',
  );
});

test('the pattern catches the shapes it is meant to', () => {
  for (const shape of [
    "req.on('close', cleanup)",
    'req.once("close", () => {})',
    'req?.addListener( `close`, fn)',
  ]) {
    assert.ok(REQ_CLOSE.test(shape), shape);
  }
  assert.ok(!REQ_CLOSE.test("res.on('close', fn)"));
  assert.ok(!REQ_CLOSE.test("req.on('data', fn)"));
});
