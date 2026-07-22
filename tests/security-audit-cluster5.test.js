/**
 * Security-audit cluster 5 regression tests (MH3).
 *
 * MH3 — unbounded public SSE connections (DoS). The follow/questions/
 *       present-session events streams are unauthenticated and long-lived;
 *       without a cap a client can open thousands and exhaust FDs/memory. The
 *       shared limiter (server/utils/sse-limiter.js) enforces a global concurrent
 *       cap always, a per-IP cap only for distinguishable (public) client IPs so
 *       a NATed/proxied audience sharing one address isn't throttled en masse,
 *       and an absolute stream lifetime.
 *
 * M4 (dependency advisory bumps) is verified out-of-band via `npm audit`, not in
 * this file.
 *
 * Run with: node --test tests/security-audit-cluster5.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tryAcquireSseSlot,
  guardSseConnection,
  sseConnectionCounts,
  resetSseConnectionCounts,
} from '../server/utils/sse-limiter.js';

const PUBLIC_IP = '8.8.8.8';
const PRIVATE_IP = '127.0.0.1';

function mockReq(remoteAddress) {
  return { socket: { remoteAddress }, headers: {} };
}

function mockRes() {
  return {
    statusCode: null,
    headers: null,
    ended: false,
    _handlers: {},
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end() {
      this.ended = true;
    },
    on(evt, fn) {
      this._handlers[evt] = fn;
    },
  };
}

function resetEnv() {
  delete process.env.SSE_MAX_CONNECTIONS;
  delete process.env.SSE_MAX_CONNECTIONS_PER_IP;
  delete process.env.SSE_MAX_LIFETIME_MS;
}

test.beforeEach(() => {
  resetSseConnectionCounts();
  resetEnv();
});

test.after(() => {
  resetSseConnectionCounts();
  resetEnv();
});

test('MH3: per-IP cap blocks a single public IP past the limit', () => {
  process.env.SSE_MAX_CONNECTIONS_PER_IP = '3';
  const req = mockReq(PUBLIC_IP);

  const slots = [];
  for (let i = 0; i < 3; i++) {
    const s = tryAcquireSseSlot(req);
    assert.equal(s.ok, true, `slot ${i} should be granted`);
    slots.push(s);
  }
  const overflow = tryAcquireSseSlot(req);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.reason, 'per-ip');

  // Releasing one frees a slot again.
  slots[0].release();
  const after = tryAcquireSseSlot(req);
  assert.equal(after.ok, true);
  after.release();
  slots.slice(1).forEach((s) => s.release());
});

test('MH3: per-IP cap is skipped for loopback/private IPs (proxy/NAT audience)', () => {
  process.env.SSE_MAX_CONNECTIONS_PER_IP = '3';
  const req = mockReq(PRIVATE_IP);

  const slots = [];
  // Well past the per-IP cap — a whole audience behind one proxy IP must not be
  // throttled to 3.
  for (let i = 0; i < 12; i++) {
    const s = tryAcquireSseSlot(req);
    assert.equal(s.ok, true, `private-IP slot ${i} should be granted`);
    slots.push(s);
  }
  // Private IPs aren't tracked per-IP at all.
  assert.equal(sseConnectionCounts().distinctIps, 0);
  assert.equal(sseConnectionCounts().global, 12);
  slots.forEach((s) => s.release());
});

test('MH3: the global cap bounds total streams even across many IPs', () => {
  process.env.SSE_MAX_CONNECTIONS = '2';
  // Use private IPs so the per-IP cap never interferes with the global check.
  const a = tryAcquireSseSlot(mockReq(PRIVATE_IP));
  const b = tryAcquireSseSlot(mockReq(PRIVATE_IP));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const c = tryAcquireSseSlot(mockReq(PRIVATE_IP));
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'global');
  a.release();
  b.release();
});

test('MH3: releasing a slot decrements both global and per-IP counts', () => {
  const req = mockReq(PUBLIC_IP);
  const s1 = tryAcquireSseSlot(req);
  const s2 = tryAcquireSseSlot(req);
  assert.equal(sseConnectionCounts().global, 2);
  assert.equal(sseConnectionCounts().distinctIps, 1);
  s1.release();
  s1.release(); // idempotent — must not double-decrement
  assert.equal(sseConnectionCounts().global, 1);
  s2.release();
  assert.equal(sseConnectionCounts().global, 0);
  assert.equal(sseConnectionCounts().distinctIps, 0);
});

test('MH3: guardSseConnection sends 429 (no event-stream) when over the cap', () => {
  process.env.SSE_MAX_CONNECTIONS = '1';
  const first = guardSseConnection(mockReq(PRIVATE_IP), mockRes());
  assert.ok(first, 'first stream is admitted');

  const res = mockRes();
  const guard = guardSseConnection(mockReq(PRIVATE_IP), res);
  assert.equal(guard, null, 'second stream is rejected');
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Content-Type'], 'text/plain; charset=utf-8');
  assert.ok(res.ended, 'the 429 response is ended, no stream left open');

  first.release();
});

test('MH3: guardSseConnection wires release to res close/finish', () => {
  const res = mockRes();
  const guard = guardSseConnection(mockReq(PUBLIC_IP), res);
  assert.ok(guard);
  assert.equal(sseConnectionCounts().global, 1);
  // Simulate the client disconnecting.
  res._handlers.close?.();
  assert.equal(sseConnectionCounts().global, 0, 'close releases the slot');
});
