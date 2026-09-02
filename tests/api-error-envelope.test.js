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
import {
  assertErrorDetails,
  PAYLOAD_KEYS,
} from '../server/utils/error-details.js';

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
    [
      (r) => payloadTooLarge(r),
      413,
      'payload_too_large',
      'Request body too large',
    ],
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
  jsonError(res, 400, 'invalid', '', { details: { field: 'email' } });
  const body = res.body();
  assert.equal(body.error, 'invalid');
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

  const safe = buildTopLevelErrorBody(
    413,
    Object.assign(new Error('too big'), { statusCode: 413 }),
  );
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
  globalThis.fetch = stubFetch(429, {
    ok: false,
    error: 'rate_limited',
    message: 'Slow down',
  });
  try {
    const { api } = await import('../client/lib/api.js');
    await assert.rejects(api('/api/whatever'), (err) => {
      assert.equal(err.statusCode, 429);
      assert.equal(err.code, 'rate_limited');
      assert.equal(err.message, 'Slow down');
      // The full parsed body rides along for callers that read
      // route-specific fields off an error (e.g. the share viewer's
      // presentationTitle on a revoked link).
      assert.deepEqual(err.body, {
        ok: false,
        error: 'rate_limited',
        message: 'Slow down',
      });
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

// ---------------------------------------------------------------------------
// errorText() — the shared display-text extractor direct-fetch callers use so
// they show the human message, never the machine code, once a route adopts the
// canonical envelope.
// ---------------------------------------------------------------------------

test('errorText prefers message over the machine code', async () => {
  const { errorText } = await import('../client/lib/api.js');
  // Canonical envelope: message is the human text, error is a code to hide.
  assert.equal(
    errorText({
      ok: false,
      error: 'internal_error',
      message: 'Failed to load users',
    }),
    'Failed to load users',
  );
});

test('errorText falls back to a legacy prose-in-error body', async () => {
  const { errorText } = await import('../client/lib/api.js');
  assert.equal(errorText({ error: 'Invalid input' }), 'Invalid input');
});

test('errorText order is message > error, then fallback', async () => {
  const { errorText } = await import('../client/lib/api.js');
  assert.equal(errorText({ message: 'm', error: 'e' }), 'm'); // message beats error
  // No `details` branch (B208): `details` is a typed object, never the sentence.
  assert.equal(errorText({ details: { field: 'title' }, error: 'e' }), 'e');
  assert.equal(errorText({}, 'nothing usable'), 'nothing usable');
  assert.equal(errorText(null, 'x'), 'x');
  assert.equal(errorText({ error: '   ' }, 'blank ignored'), 'blank ignored'); // whitespace-only skipped
});

// ---------------------------------------------------------------------------
// The `details` register (B208 / D78)
//
// `error` is the discriminator, `details` the payload that code carries. The
// register in `server/utils/error-details.js` names the keys per code; the two
// emission points that know the code enforce it, throwing outside production.
// ---------------------------------------------------------------------------

test('every registered code passes with exactly its keys', () => {
  const samples = {
    held: { lock: { slideId: 's1' } },
    conflict: { id: 'p1', revision: 4, modified: 'now', updatedBy: 'a@b.c' },
    locked: { slideId: 's1', lockKind: 'author', holder: null },
    conversion_failed: { report: { errors: [] } },
    maintenance: { active: true, reason: 'upgrade', retryAfter: 30 },
    sandbox_quota_exceeded: { resource: 'decks', limit: 2, used: 2 },
  };
  assert.deepEqual(
    Object.keys(samples).sort(),
    Object.keys(PAYLOAD_KEYS).sort(),
    'the sample set covers the register — add a sample when you add a code',
  );
  for (const [code, details] of Object.entries(samples)) {
    const res = new MockRes();
    jsonError(res, 400, code, 'nope', { details });
    assert.deepEqual(res.body().details, details, code);
  }
});

test('a stray key on a registered code throws outside production', () => {
  assert.throws(
    () =>
      jsonError(new MockRes(), 409, 'conflict', 'nope', {
        details: { id: 'p1', revision: 4, whoops: true },
      }),
    /Unregistered key "whoops"/,
  );
});

test('an unregistered code may send no details at all', () => {
  assert.throws(
    () =>
      jsonError(new MockRes(), 503, 'ai_unavailable', 'nope', {
        details: { reason: 'no vendor' },
      }),
    /Unregistered details on error "ai_unavailable"/,
  );
});

test('details is never a string, and never an array', () => {
  for (const bad of ['a sentence', ['a', 'list']]) {
    assert.throws(
      () =>
        jsonError(new MockRes(), 501, 'notion_not_configured', 'nope', {
          details: bad,
        }),
      /Non-object details/,
      JSON.stringify(bad),
    );
  }
});

test('a storage reason carries the location shape, not a payload', () => {
  const res = new MockRes();
  const details = { field: 'items', index: 2, itemIndex: 0, reason: 'empty' };
  jsonError(res, 400, 'invalid', 'Invalid input', { details });
  assert.deepEqual(res.body().details, details);

  // Location keys only: a payload key is not in a storage reason's vocabulary.
  assert.throws(
    () =>
      jsonError(new MockRes(), 400, 'invalid', 'nope', {
        details: { field: 'items', report: {} },
      }),
    /Unregistered key "report"/,
  );
});

test('AppError.toJSON() runs through the same assertion', () => {
  const ok = new AppError('Conflict', 409, { id: 'p1', revision: 4 });
  assert.deepEqual(ok.toJSON().details, { id: 'p1', revision: 4 });

  const bad = new AppError('Nope', 500, { anything: 1 });
  assert.throws(() => bad.toJSON(), /Unregistered details on error/);
});

test('assertErrorDetails lets a violation through in production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    // A contract slip must never turn a running instance's 4xx into a 500.
    assert.doesNotThrow(() => assertErrorDetails('ai_unavailable', { a: 1 }));
    const res = new MockRes();
    jsonError(res, 503, 'ai_unavailable', 'nope', { details: { a: 1 } });
    assert.deepEqual(res.body().details, { a: 1 });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('absent details always passes, for any code', () => {
  assert.doesNotThrow(() => assertErrorDetails('whatever', undefined));
  assert.doesNotThrow(() => assertErrorDetails('whatever', null));
  const res = new MockRes();
  jsonError(res, 501, 'notion_not_configured', 'off');
  assert.ok(!('details' in res.body()));
});

test('the slide-merge conflict serializes with its full registered payload', () => {
  // The 409 with `conflictingSlides` is built in `storage/presentations/
  // index.js`, not in the shared `conflictError()` helper — the path a plain
  // `.details` assertion never serializes. Pin the envelope, not the throw.
  const err = new AppError('Conflict: the same slides were modified.', 409, {
    id: 'p1',
    revision: 7,
    modified: '2026-09-02T00:00:00.000Z',
    updatedBy: 'a@b.c',
    conflictingSlides: ['s3'],
  });
  const body = err.toJSON();
  assert.equal(body.error, 'conflict');
  assert.deepEqual(body.details.conflictingSlides, ['s3']);
});
