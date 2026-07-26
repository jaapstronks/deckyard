/**
 * SSE `error` events carry `{ message }`, deliberately NOT the HTTP envelope.
 *
 * The rule (see AGENTS.md and docs/reference/api-error-format.md): an error on
 * an already-open `text/event-stream` is a named event, so the `event: error`
 * line is the discriminator. `ok:false` would duplicate that routing inside the
 * payload, and `error` stays reserved for the machine code it means on the HTTP
 * side rather than being re-used for prose — the exact habit the envelope work
 * (#346/#347/#361) removed.
 *
 * Two layers are locked here: the shared producer in `server/utils/sse.js`, and
 * a source guard over the routes that build their own `sendEvent` closure — the
 * seven sites drifted precisely because each one hand-rolled its payload.
 *
 * Run with: node --test tests/sse-error-event-shape.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sseErrorPayload, sseError } from '../server/utils/sse.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal writable stand-in that records everything written to the stream. */
function fakeRes() {
  return {
    writable: true,
    writableEnded: false,
    written: '',
    write(chunk) {
      this.written += chunk;
      return true;
    },
  };
}

test('sseErrorPayload carries message and nothing from the HTTP envelope', () => {
  const payload = sseErrorPayload('Conversion failed');
  assert.deepEqual(payload, { message: 'Conversion failed' });
  assert.ok(!('ok' in payload), 'no ok field: the event name is the discriminator');
  assert.ok(!('error' in payload), 'no error key: that slot means machine code on HTTP');
});

test('sseErrorPayload keeps endpoint-specific extras alongside message', () => {
  const report = { errors: ['bad slide'] };
  assert.deepEqual(sseErrorPayload('Conversion failed', { report }), {
    message: 'Conversion failed',
    report,
  });
});

test('sseErrorPayload coerces a missing message rather than emitting undefined', () => {
  assert.deepEqual(sseErrorPayload(), { message: 'Unknown error' });
  assert.deepEqual(sseErrorPayload(null), { message: 'Unknown error' });
  assert.deepEqual(sseErrorPayload(''), { message: 'Unknown error' });
});

test('the documented upgrade path is additive, not a rename', () => {
  // A future consumer that needs to branch gets `error` NEXT TO `message`, with
  // the HTTP meaning. `message` must survive that, or clients break.
  const payload = sseErrorPayload('Notion session expired', { error: 'notion_unauthorized' });
  assert.equal(payload.message, 'Notion session expired');
  assert.equal(payload.error, 'notion_unauthorized');
});

test('sseError writes a well-formed SSE frame on the error event', () => {
  const res = fakeRes();
  sseError(res, 'Import failed');
  assert.match(res.written, /^event: error\n/);
  const dataLine = res.written.split('\n').find((l) => l.startsWith('data: '));
  assert.ok(dataLine, 'frame has a data line');
  assert.deepEqual(JSON.parse(dataLine.slice(6)), { message: 'Import failed' });
  assert.ok(res.written.endsWith('\n\n'), 'frame is terminated by a blank line');
});

test('sseError stays silent on a closed stream', () => {
  const res = fakeRes();
  res.writableEnded = true;
  sseError(res, 'too late');
  assert.equal(res.written, '', 'nothing written after the response ended');
});

// --- source guard -----------------------------------------------------------

// Every route that emits an SSE `error` event. Listed explicitly so a new
// streaming route has to be added here consciously.
const SSE_ERROR_ROUTES = [
  'server/routes/api/convert.js',
  'server/routes/api/notion/import.js',
  'server/routes/api/ai/wizard-v2-stream.js',
  'server/routes/api/presentations/analyze.js',
  'server/routes/api/presentations/import-slides-as-images.js',
];

test('no route hand-rolls an SSE error payload with an `error:` prose key', () => {
  const offenders = [];
  for (const rel of SSE_ERROR_ROUTES) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    // An error emission that opens an object literal inline is hand-rolling the
    // shape instead of going through the shared producer.
    // `sendSSE` takes `res` first, `sendEvent` closures don't — allow both.
    const inlineObject = /send(?:Event|SSE)\(\s*(?:res\s*,\s*)?'error'\s*,\s*\{/.test(src)
      || /event:\s*'error'\s*,\s*\n?\s*data:\s*\{/.test(src);
    if (inlineObject) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `these routes build an SSE error payload inline instead of via sseErrorPayload/sseError: ${offenders.join(', ')}`
  );
});

test('every listed route reaches the shared SSE error producer', () => {
  const missing = SSE_ERROR_ROUTES.filter((rel) => {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    return !/sseErrorPayload|sseError\b/.test(src);
  });
  assert.deepEqual(missing, [], `routes not using the shared producer: ${missing.join(', ')}`);
});
