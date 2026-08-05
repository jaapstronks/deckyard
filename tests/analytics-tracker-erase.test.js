/**
 * The client half of the anonymous erasure: `createAnalyticsTracker(...).erase()`
 * (`client/lib/format/analytics-tracker.js`).
 *
 * The server route is pinned in `tests/analytics-track-erase.test.js` and the
 * shared button in `tests/analytics-erase-button.test.js` (with a mocked
 * tracker); this covers the tracker's own erase transition, which neither of
 * those reaches. Two rules:
 *
 *   1. **A failed erase changes nothing client-side.** When the server refuses
 *      (rate limit, network, 5xx), the tracker stays live and the device id
 *      stays in localStorage — the "try again" the button offers must actually
 *      be able to succeed, and the history must stay reachable for a later
 *      erase. Tearing down on failure would strand the server-side rows behind
 *      a device id no future session can ever prove possession of again.
 *   2. **A successful erase tears down and forgets the device.** No further
 *      tracking, no session token, no end beacon for sessions that no longer
 *      exist, and the device id is dropped so the next visit is a fresh
 *      identity rather than a re-link to the erased history.
 *
 * Run with: node --test tests/analytics-tracker-erase.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/share/abc',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

// Scripted fetch double: each sendTrack call is recorded and answered by the
// current responder. No retries trigger in these tests (4xx is never retried).
let fetchCalls = [];
let respond = async () => ({ ok: true, status: 200, json: async () => ({}) });
globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url, body: JSON.parse(opts.body) });
  return respond(url);
};

const { createAnalyticsTracker } = await import(
  '../client/lib/format/analytics-tracker.js'
);
const { storage } = await import('../client/lib/storage.js');

const DEVICE_ID_KEY = 'ps.analytics.deviceId';
const TOKEN = 'abcd0123'.repeat(8);

const ok = (payload) => async () => ({
  ok: true,
  status: 200,
  json: async () => payload,
});
const refuse = (status) => async () => ({
  ok: false,
  status,
  json: async () => ({ error: 'refused' }),
});

/** A started tracker with a live session token. */
async function startTracker() {
  fetchCalls = [];
  respond = ok({ sessionToken: TOKEN });
  const tracker = createAnalyticsTracker({
    presentationId: 'deck-one',
    sourceType: 'share_link',
    sourceId: 'share-token',
  });
  assert.equal(await tracker.start(), true, 'the session started');
  return tracker;
}

test('a failed erase leaves the tracker live and the device id in place', async () => {
  const tracker = await startTracker();
  const deviceId = storage.get(DEVICE_ID_KEY);
  assert.ok(deviceId, 'a device id was minted on start');

  respond = refuse(429);
  const result = await tracker.erase();

  assert.equal(result, null, 'the refusal surfaces as a null result');
  assert.equal(tracker.isTracking(), true, 'the tracker is still live');
  assert.equal(tracker.getSessionToken(), TOKEN, 'the session token survives');
  assert.equal(storage.get(DEVICE_ID_KEY), deviceId, 'the device id survives');

  // The retry the button offers can now actually succeed.
  respond = ok({ ok: true, deleted: { sessions: 1, slideViews: 0 } });
  const retry = await tracker.erase();
  assert.equal(retry?.ok, true, 'the retry erased');
});

test('a successful erase tears the tracker down and drops the device id', async () => {
  const tracker = await startTracker();
  respond = ok({ ok: true, deleted: { sessions: 2, slideViews: 5 } });

  const result = await tracker.erase();

  assert.deepEqual(result, { ok: true, deleted: { sessions: 2, slideViews: 5 } });
  assert.equal(tracker.isTracking(), false, 'tracking has stopped');
  assert.equal(tracker.getSessionToken(), null, 'the token is gone');
  assert.equal(storage.get(DEVICE_ID_KEY), null, 'the device id is forgotten');

  // Dead tracker: a second erase is a no-op, and no further requests fire.
  const before = fetchCalls.length;
  assert.equal(await tracker.erase(), null);
  assert.equal(fetchCalls.length, before, 'no request left the dead tracker');
});
