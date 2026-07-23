/**
 * The canonical internal error envelope:
 *   { ok: false, error: '<machine_code>', message?: '<human>', details?: ... }
 *
 * `error` is always a stable snake_case code (clients branch on it); `message`
 * carries human display text. This locks the contract across the three surfaces
 * that produce it — the http.js helpers, the AppError classes, and the
 * top-level handler — plus the client `api()` helper that consumes it.
 *
 * Run with: node --test tests/api-error-envelope.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';

import {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  rateLimited,
  serverError,
  payloadTooLarge,
  methodNotAllowed,
  jsonError,
} from '../server/utils/http.js';
import {
  AppError,
  ValidationError,
  errorToResponse,
  codeForStatus,
} from '../server/utils/errors.js';
import { buildTopLevelErrorBody } from '../server/utils/error-response.js';

/** Minimal ServerResponse stand-in that records status, headers and body. */
class MockRes {
  constructor() {
    this.headers = {};
    this.statusCode = null;
    this.chunks = [];
  }
  writeHead(status, headers) {
    this.statusCode = status;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        this.headers[String(k).toLowerCase()] = v;
      }
    }
    return this;
  }
  end(chunk) {
    if (chunk != null) this.chunks.push(Buffer.from(chunk));
  }
  body() {
    return JSON.parse(Buffer.concat(this.chunks).toString('utf8'));
  }
}

// ---------------------------------------------------------------------------
// http.js helpers
// ---------------------------------------------------------------------------

test('every http helper emits { ok:false, error:<code>, message }', () => {
  const cases = [
    [(r) => badRequest(r, 'Nope'), 400, 'bad_request', 'Nope'],
    [(r) => unauthorized(r, 'No token'), 401, 'unauthorized', 'No token'],
    [(r) => forbidden(r, 'Denied'), 403, 'forbidden', 'Denied'],
    [(r) => notFound(r, 'Gone'), 404, 'not_found', 'Gone'],
    [(r) => serverError(r), 500, 'internal_error', 'Internal server error'],
    [(r) => payloadTooLarge(r), 413, 'payload_too_large', 'Request body too large'],
  ];
  for (const [fn, status, code, message] of cases) {
    const res = new MockRes();
    fn(res);
    assert.equal(res.statusCode, status, code);
    const body = res.body();
    assert.equal(body.ok, false, `${code}: ok:false`);
    assert.equal(body.error, code, `${code}: machine code in error`);
    assert.equal(body.message, message, `${code}: human message`);
  }
});

test('rateLimited carries the machine code and a Retry-After header', () => {
  const res = new MockRes();
  rateLimited(res, 30);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['retry-after'], '30');
  assert.equal(res.body().error, 'rate_limited');
});

test('methodNotAllowed carries the code and an Allow header', () => {
  const res = new MockRes();
  methodNotAllowed(res, ['GET', 'POST']);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, POST');
  assert.equal(res.body().error, 'method_not_allowed');
});

test('jsonError echoes details and omits an empty message', () => {
  const res = new MockRes();
  jsonError(res, 400, 'invalid_email', '', { details: { field: 'email' } });
  const body = res.body();
  assert.equal(body.error, 'invalid_email');
  assert.ok(!('message' in body), 'empty message is omitted');
  assert.deepEqual(body.details, { field: 'email' });
});

// ---------------------------------------------------------------------------
// AppError classes
// ---------------------------------------------------------------------------

test('AppError.toJSON is the canonical envelope with a status-derived code', () => {
  assert.deepEqual(new ValidationError('Bad field').toJSON(), {
    ok: false,
    error: 'bad_request',
    message: 'Bad field',
  });
  assert.equal(codeForStatus(409), 'conflict');
  assert.equal(new AppError('x', 429).code, 'rate_limited');
  assert.equal(new AppError('x', 500, null, 'custom_code').code, 'custom_code');
});

test('errorToResponse codes a plain (non-App) error by its status', () => {
  const err = new Error('boom');
  err.statusCode = 404;
  assert.deepEqual(errorToResponse(err), {
    ok: false,
    error: 'not_found',
    message: 'boom',
  });
});

test('top-level handler stays generic for 500 and safe for sub-500', () => {
  const leak = buildTopLevelErrorBody(500, new Error('SELECT * FROM secrets'));
  assert.equal(leak.error, 'server_error');
  assert.equal(leak.message, 'Server error');
  assert.doesNotMatch(JSON.stringify(leak), /SELECT/);

  const safe = buildTopLevelErrorBody(413, Object.assign(new Error('too big'), { statusCode: 413 }));
  assert.equal(safe.error, 'request_error');
  assert.equal(safe.message, 'too big');
});

// ---------------------------------------------------------------------------
// client api() consumes the envelope
// ---------------------------------------------------------------------------

/** Build a fetch stub returning one JSON response. */
function stubFetch(status, obj) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json; charset=utf-8' },
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  });
}

test('api() maps the coded envelope to err.code + err.message', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(429, { ok: false, error: 'rate_limited', message: 'Slow down' });
  try {
    const { api } = await import('../client/lib/api.js');
    await assert.rejects(api('/api/whatever'), (err) => {
      assert.equal(err.statusCode, 429);
      assert.equal(err.code, 'rate_limited');
      assert.equal(err.message, 'Slow down');
      return true;
    });
  } finally {
    globalThis.fetch = orig;
  }
});

test('api() falls back to error text for a legacy prose body', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(400, { error: 'Invalid input' });
  try {
    const { api } = await import('../client/lib/api.js');
    await assert.rejects(api('/api/whatever'), (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'Invalid input'); // code mirrors error field
      assert.equal(err.message, 'Invalid input'); // and surfaces as display text
      return true;
    });
  } finally {
    globalThis.fetch = orig;
  }
});
