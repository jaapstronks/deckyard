/**
 * Contract for the one canonical client SSE helper (B75, decision D33).
 *
 * `createSSEConnection` replaced two divergent reconnect strategies
 * (`createSSEConnection` + `withBackoff`) with one. These lock down the parts
 * that used to differ between them and the "nothing outlives its view" teardown
 * rule that a hand-rolled reopen timer kept breaking.
 *
 * Run with: node --test tests/sse-connection.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSSEConnection, LONG_LIVED_STREAM } from '../client/lib/net/sse-connection.js';

/** Minimal stand-in for the browser EventSource, driven by test helpers. */
class FakeEventSource {
  static instances = [];
  static reset() {
    FakeEventSource.instances = [];
  }
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.listeners = {};
    this.onopen = null;
    this.onerror = null;
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  // --- test drivers ---
  fireOpen() {
    this.onopen?.();
  }
  fireError() {
    this.onerror?.();
  }
  fire(type, data) {
    for (const fn of this.listeners[type] || []) fn({ type, data });
  }
  static latest() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}

function withFakeEventSource(t) {
  const prev = globalThis.EventSource;
  FakeEventSource.reset();
  globalThis.EventSource = FakeEventSource;
  t.after(() => {
    globalThis.EventSource = prev;
  });
}

test('connect() opens one stream and reports CONNECTED on open', (t) => {
  withFakeEventSource(t);
  const states = [];
  let connected = 0;
  const conn = createSSEConnection({
    url: '/x',
    events: ['msg'],
    onEvent: () => {},
    onConnected: () => {
      connected += 1;
    },
    onStateChange: (s) => states.push(s),
  });
  conn.connect();
  assert.equal(FakeEventSource.instances.length, 1);
  FakeEventSource.latest().fireOpen();
  assert.equal(connected, 1);
  assert.equal(conn.getState(), conn.STATE.CONNECTED);
  assert.ok(states.includes('connecting'));
  assert.ok(states.includes('connected'));
});

test('onEvent receives listed events', (t) => {
  withFakeEventSource(t);
  const seen = [];
  const conn = createSSEConnection({
    url: '/x',
    events: ['msg'],
    onEvent: (e) => seen.push([e.type, e.data]),
  });
  conn.connect();
  FakeEventSource.latest().fire('msg', '42');
  assert.deepEqual(seen, [['msg', '42']]);
});

test('reconnects after a drop and re-opens once the backoff elapses', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeEventSource(t);
  const conn = createSSEConnection({
    url: '/x',
    events: ['msg'],
    onEvent: () => {},
    baseDelayMs: 1000,
  });
  conn.connect();
  FakeEventSource.latest().fireError();
  assert.equal(conn.getState(), conn.STATE.RECONNECTING);
  assert.equal(FakeEventSource.instances.length, 1); // not yet
  t.mock.timers.tick(1000);
  assert.equal(FakeEventSource.instances.length, 2); // reopened
});

test('maxReconnectAttempts: 0 makes a drop terminal, quietly', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeEventSource(t);
  let errors = 0;
  const conn = createSSEConnection({
    url: '/x',
    events: ['msg'],
    onEvent: () => {},
    onError: () => {
      errors += 1;
    },
    maxReconnectAttempts: 0,
  });
  conn.connect();
  FakeEventSource.latest().fireError();
  t.mock.timers.tick(60_000);
  assert.equal(FakeEventSource.instances.length, 1); // never reopened
  assert.equal(conn.getState(), conn.STATE.FAILED);
  assert.equal(errors, 0); // no spurious "max reached" error
});

test('a finite cap eventually FAILs with a max-reached error', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeEventSource(t);
  const errs = [];
  const conn = createSSEConnection({
    url: '/x',
    events: ['msg'],
    onEvent: () => {},
    onError: (e) => errs.push(e),
    baseDelayMs: 1000,
    maxReconnectAttempts: 2,
  });
  conn.connect();
  // Drop, retry, drop, retry, drop -> exhausts 2 attempts.
  FakeEventSource.latest().fireError();
  t.mock.timers.tick(1000);
  FakeEventSource.latest().fireError();
  t.mock.timers.tick(2000);
  FakeEventSource.latest().fireError();
  assert.equal(conn.getState(), conn.STATE.FAILED);
  assert.equal(errs.length, 1);
  assert.match(String(errs[0]?.message), /Max reconnection attempts/);
});

test('maxDelayMs caps the exponential backoff', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeEventSource(t);
  const conn = createSSEConnection({
    url: '/x',
    events: ['msg'],
    onEvent: () => {},
    baseDelayMs: 1000,
    maxDelayMs: 2000,
    maxReconnectAttempts: Infinity,
  });
  conn.connect();
  // attempt 0 -> 1000, attempt 1 -> 2000, attempt 2 -> would be 4000 but capped.
  FakeEventSource.latest().fireError();
  t.mock.timers.tick(1000);
  FakeEventSource.latest().fireError();
  t.mock.timers.tick(2000);
  FakeEventSource.latest().fireError();
  assert.equal(FakeEventSource.instances.length, 3);
  // Raw delay would be 4000; the cap means 2000 is enough to reopen.
  t.mock.timers.tick(2000);
  assert.equal(FakeEventSource.instances.length, 4);
});

test('LONG_LIVED_STREAM never gives up', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeEventSource(t);
  const conn = createSSEConnection({
    url: '/x',
    events: ['msg'],
    onEvent: () => {},
    ...LONG_LIVED_STREAM,
  });
  conn.connect();
  for (let i = 0; i < 20; i++) {
    FakeEventSource.latest().fireError();
    t.mock.timers.tick(30_000);
  }
  assert.notEqual(conn.getState(), conn.STATE.FAILED);
  assert.ok(FakeEventSource.instances.length > 10);
});

test('stop() cancels a pending reopen and closes the stream', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeEventSource(t);
  const conn = createSSEConnection({
    url: '/x',
    events: ['msg'],
    onEvent: () => {},
    baseDelayMs: 1000,
    maxReconnectAttempts: Infinity,
  });
  conn.connect();
  const first = FakeEventSource.latest();
  first.fireError(); // schedules a reopen
  conn.stop();
  assert.equal(first.closed, true);
  t.mock.timers.tick(60_000);
  // The retry in flight when stop() landed must never fire.
  assert.equal(FakeEventSource.instances.length, 1);
});

test('stop() is reversible: connect() works again afterwards', (t) => {
  withFakeEventSource(t);
  const conn = createSSEConnection({ url: '/x', events: ['msg'], onEvent: () => {} });
  conn.connect();
  conn.stop();
  conn.connect();
  assert.equal(FakeEventSource.instances.length, 2);
  assert.equal(FakeEventSource.latest().closed, false);
});

test('the connected event resets the backoff and is delivered to onEvent', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withFakeEventSource(t);
  const seen = [];
  const conn = createSSEConnection({
    url: '/x',
    events: ['msg'],
    onEvent: (e) => seen.push(e.type),
    baseDelayMs: 1000,
  });
  conn.connect();
  FakeEventSource.latest().fireError();
  t.mock.timers.tick(1000); // attempt 1 opens
  FakeEventSource.latest().fire('connected', '{}');
  assert.equal(conn.getState(), conn.STATE.CONNECTED);
  assert.ok(seen.includes('connected'));
  // Backoff reset: the next drop reopens after the base delay again.
  FakeEventSource.latest().fireError();
  t.mock.timers.tick(1000);
  assert.equal(FakeEventSource.latest().closed, false);
});
