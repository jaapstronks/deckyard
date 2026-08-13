/**
 * Direct unit tests for openSseStream() — the one opener every SSE endpoint
 * goes through (#716). Pins the pieces the route-level tests only exercise
 * indirectly: the canonical header set with extraHeaders passthrough, the
 * heartbeat lifecycle, idempotent close, the guard opt-in/opt-out, and the
 * onClose contract (fires once on client disconnect, never for a stream the
 * handler already closed itself — the MCP GET-replace race).
 *
 * Run with: node --test tests/sse-open-stream.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openSseStream } from '../server/utils/sse.js';
import {
  sseConnectionCounts,
  resetSseConnectionCounts,
} from '../server/utils/sse-limiter.js';

function mockReq() {
  const req = new EventEmitter();
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function mockRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.writableEnded = false;
  res.statusCode = null;
  res.headers = null;
  res.written = [];
  res.flushed = false;
  res.writeHead = (status, headers) => {
    res.statusCode = status;
    res.headers = headers;
  };
  res.flushHeaders = () => {
    res.flushed = true;
  };
  res.write = (chunk) => {
    res.written.push(String(chunk));
    return true;
  };
  res.end = (chunk) => {
    if (chunk) res.written.push(String(chunk));
    res.writable = false;
    res.writableEnded = true;
  };
  return res;
}

test('writes the canonical header set and flushes it', () => {
  const req = mockReq();
  const res = mockRes();
  const stream = openSseStream(req, res, { guard: false, heartbeatMs: 0 });

  assert.equal(stream.ok, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.equal(res.headers['Cache-Control'], 'no-cache');
  assert.equal(res.headers.Connection, 'keep-alive');
  assert.equal(res.headers['X-Accel-Buffering'], 'no');
  assert.equal(res.flushed, true, 'headers forced onto the wire');
});

test('cacheControl and extraHeaders pass through into the header block', () => {
  const req = mockReq();
  const res = mockRes();
  openSseStream(req, res, {
    guard: false,
    heartbeatMs: 0,
    cacheControl: 'no-cache, no-transform',
    extraHeaders: { 'Set-Cookie': 'dk_follow=abc; Path=/' },
  });

  assert.equal(res.headers['Cache-Control'], 'no-cache, no-transform');
  assert.equal(res.headers['Set-Cookie'], 'dk_follow=abc; Path=/');
  // extraHeaders extend the canonical set, they don't replace it.
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
});

test('heartbeat comments tick on the interval and stop on close', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const req = mockReq();
  const res = mockRes();
  openSseStream(req, res, { guard: false, heartbeatMs: 1000 });

  const heartbeats = () =>
    res.written.filter((w) => w.startsWith(': heartbeat')).length;

  assert.equal(heartbeats(), 0);
  t.mock.timers.tick(1000);
  assert.equal(heartbeats(), 1);
  t.mock.timers.tick(1000);
  assert.equal(heartbeats(), 2);

  req.emit('close');
  t.mock.timers.tick(5000);
  assert.equal(heartbeats(), 2, 'heartbeat cleared on close');
});

test('heartbeatMs: 0 disables the heartbeat entirely', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const req = mockReq();
  const res = mockRes();
  openSseStream(req, res, { guard: false, heartbeatMs: 0 });
  t.mock.timers.tick(60_000);
  assert.equal(res.written.length, 0);
});

test('onClose fires exactly once, also under a double close event', () => {
  const req = mockReq();
  const res = mockRes();
  let closes = 0;
  openSseStream(req, res, {
    guard: false,
    heartbeatMs: 0,
    onClose: () => { closes += 1; },
  });

  req.emit('close');
  req.emit('close');
  assert.equal(closes, 1);
});

test('close() is idempotent and suppresses a later onClose (replace race)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const req = mockReq();
  const res = mockRes();
  let closes = 0;
  const stream = openSseStream(req, res, {
    guard: false,
    heartbeatMs: 1000,
    onClose: () => { closes += 1; },
  });

  // The handler closes the stream itself (as MCP GET does when a new stream
  // replaces a running one) …
  stream.close();
  stream.close();
  t.mock.timers.tick(5000);
  assert.equal(res.written.length, 0, 'heartbeat cleared by handler close');

  // … so the old socket's eventual disconnect must NOT run onClose: the
  // handler's references already point at the replacement stream.
  req.emit('close');
  assert.equal(closes, 0);
});

test('guard: true reserves a limiter slot and releases it with the response', (t) => {
  resetSseConnectionCounts();
  t.after(resetSseConnectionCounts);

  const req = mockReq();
  const res = mockRes();
  const stream = openSseStream(req, res); // guard defaults to true
  assert.equal(stream.ok, true);
  assert.equal(sseConnectionCounts().global, 1);

  res.emit('close');
  assert.equal(sseConnectionCounts().global, 0);
});

test('guard: false bypasses the limiter completely', (t) => {
  resetSseConnectionCounts();
  t.after(resetSseConnectionCounts);

  const req = mockReq();
  const res = mockRes();
  const stream = openSseStream(req, res, { guard: false, heartbeatMs: 0 });
  assert.equal(stream.ok, true);
  assert.equal(sseConnectionCounts().global, 0);
});

test('guard over cap: sends 429 before any stream headers, returns ok: false', (t) => {
  resetSseConnectionCounts();
  t.after(() => {
    resetSseConnectionCounts();
    delete process.env.SSE_MAX_CONNECTIONS;
  });
  process.env.SSE_MAX_CONNECTIONS = '1';

  const first = openSseStream(mockReq(), mockRes());
  assert.equal(first.ok, true);

  const res = mockRes();
  const second = openSseStream(mockReq(), res);
  assert.equal(second.ok, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.writableEnded, true, 'guard fully handled the response');
  assert.notEqual(res.headers['Content-Type'], 'text/event-stream');
});
