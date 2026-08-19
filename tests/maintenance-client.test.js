/**
 * Client side of maintenance mode: the state module and the banner.
 *
 * The assertion that matters most is the last one. The announcement that
 * maintenance *started* arrives over an SSE stream that the restart then drops,
 * so nothing will ever announce the end of it over that same stream. The client
 * has to ask on reconnect — and a failed ask must leave the banner up, because
 * "the server did not answer" is not evidence that the server is back.
 *
 * Run with: node --test tests/maintenance-client.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;

const {
  getMaintenanceState,
  isMaintenanceActive,
  onMaintenanceChange,
  refreshMaintenanceState,
  resetMaintenanceStateForTests,
  setMaintenanceState,
} = await import('../client/lib/state/maintenance.js');
const { startMaintenanceBanner, syncMaintenanceBanner } =
  await import('../client/views/shared/maintenance-banner.js');

function banner() {
  return document.querySelector('.maintenance-banner');
}

test('state starts inactive with a usable retry hint', () => {
  resetMaintenanceStateForTests();
  assert.equal(isMaintenanceActive(), false);
  assert.equal(getMaintenanceState().retryAfter, 30);
});

test('subscribers fire on transitions only, not on every announcement', () => {
  resetMaintenanceStateForTests();
  const seen = [];
  onMaintenanceChange((s) => seen.push(s.active));

  assert.equal(setMaintenanceState({ active: true, reason: 'shutdown' }), true);
  // A repeat announcement (or a reconnect re-reading the same state) must not
  // re-fire the banner and the toast.
  assert.equal(
    setMaintenanceState({ active: true, reason: 'shutdown' }),
    false,
  );
  assert.equal(setMaintenanceState({ active: false }), true);

  assert.deepEqual(seen, [true, false]);
  resetMaintenanceStateForTests();
});

test('a nonsense retryAfter falls back instead of propagating NaN', () => {
  resetMaintenanceStateForTests();
  setMaintenanceState({ active: true, retryAfter: 'soon' });
  assert.equal(getMaintenanceState().retryAfter, 30);
  setMaintenanceState({ active: false, retryAfter: 90 });
  assert.equal(getMaintenanceState().retryAfter, 90);
  resetMaintenanceStateForTests();
});

test('the banner mounts on the body and leaves on resume', () => {
  resetMaintenanceStateForTests();
  const stop = startMaintenanceBanner();
  assert.equal(banner(), null, 'nothing shown while healthy');

  setMaintenanceState({ active: true, reason: 'shutdown' });
  const el = banner();
  assert.ok(el, 'banner appears');
  assert.equal(
    el.parentElement,
    document.body,
    'mounted outside the view root',
  );
  assert.equal(el.getAttribute('role'), 'alert', 'interrupting, so assertive');
  assert.match(el.textContent, /maintenance/i);

  setMaintenanceState({ active: false });
  assert.equal(banner(), null, 'banner leaves');

  stop();
  resetMaintenanceStateForTests();
});

test('syncing twice does not stack two banners', () => {
  resetMaintenanceStateForTests();
  const stop = startMaintenanceBanner();
  setMaintenanceState({ active: true });
  syncMaintenanceBanner();
  syncMaintenanceBanner();
  assert.equal(document.querySelectorAll('.maintenance-banner').length, 1);
  stop();
  assert.equal(banner(), null, 'stopping removes it');
  resetMaintenanceStateForTests();
});

test('refresh adopts the server answer', async () => {
  resetMaintenanceStateForTests();
  const changed = await refreshMaintenanceState(async () => ({
    ok: true,
    json: async () => ({ active: true, reason: 'configured', retryAfter: 60 }),
  }));
  assert.equal(changed, true);
  assert.equal(isMaintenanceActive(), true);
  assert.equal(getMaintenanceState().retryAfter, 60);
  resetMaintenanceStateForTests();
});

test('an unreachable server does not read as "maintenance is over"', async () => {
  resetMaintenanceStateForTests();
  setMaintenanceState({ active: true, reason: 'shutdown' });

  // The restart is exactly when this fetch fails. Clearing the banner here
  // would tell the user everything is fine while every write still bounces.
  const afterThrow = await refreshMaintenanceState(async () => {
    throw new Error('ECONNREFUSED');
  });
  assert.equal(afterThrow, false);
  assert.equal(isMaintenanceActive(), true, 'still in maintenance');

  const afterFiveHundred = await refreshMaintenanceState(async () => ({
    ok: false,
    status: 502,
    json: async () => ({ active: false }),
  }));
  assert.equal(afterFiveHundred, false);
  assert.equal(isMaintenanceActive(), true, 'a 502 is not an all-clear either');

  resetMaintenanceStateForTests();
});
