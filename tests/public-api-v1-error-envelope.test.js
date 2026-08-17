/**
 * B61 — the public /api/v1 surface speaks exactly one error envelope:
 *
 *   { "error": "<snake_case_machine_code>", "message": "<human text>", "details"?: … }
 *
 * and never the internal `{ ok:false, … }` shape. This pins the low-level
 * emitter (`sendV1Error`), the header-adding wrapper (`apiError`), and the
 * mount-level error wrap (`withV1ErrorHandler`) that catches an unexpected
 * throw from any v1 handler and answers it in this envelope — the guard that
 * stops a third envelope-shape from growing back (brief § Bevindingen deel 3,
 * bevinding 11 + the tighten-scan mechanism note).
 *
 * Run with: node --test tests/public-api-v1-error-envelope.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sendV1Error,
  apiError,
  withV1ErrorHandler,
} from '../server/routes/public-api/v1/middleware.js';
import { LockedError, ValidationError } from '../server/utils/errors.js';
import { handleApi } from '../server/routes/api/index.js';
import {
  setMaintenanceActive,
  resetMaintenanceForTests,
} from '../server/config/maintenance.js';

/** A minimal response double that records status, headers and the JSON body. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    headersSent: false,
    writableEnded: false,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      this.headersSent = true;
    },
    end(payload) {
      this.body = payload ?? null;
      this.writableEnded = true;
    },
  };
}

function bodyOf(res) {
  return JSON.parse(String(res.body));
}

// ---------------------------------------------------------------------------
// The emitter
// ---------------------------------------------------------------------------

test('sendV1Error emits { error, message } with no `ok`, code defaulting from status', () => {
  const res = makeRes();
  sendV1Error(res, 404, 'Nope');
  assert.equal(res.statusCode, 404);
  const body = bodyOf(res);
  assert.deepEqual(body, { error: 'not_found', message: 'Nope' });
  assert.ok(!('ok' in body), 'the public envelope carries no `ok` discriminator');
});

test('sendV1Error honors an explicit code and attaches details + headers', () => {
  const res = makeRes();
  sendV1Error(res, 429, 'Slow down', {
    code: 'rate_limited',
    details: { limit: 10 },
    headers: { 'Retry-After': '60' },
  });
  assert.equal(res.statusCode, 429);
  assert.deepEqual(bodyOf(res), { error: 'rate_limited', message: 'Slow down', details: { limit: 10 } });
  assert.equal(res.headers['Retry-After'], '60');
});

test('sendV1Error omits message and details when absent/null', () => {
  const res = makeRes();
  sendV1Error(res, 500, undefined, { details: null });
  assert.deepEqual(bodyOf(res), { error: 'internal_error' });
});

test('apiError produces the same envelope (ctx without an apiKey adds no rate headers)', async () => {
  const res = makeRes();
  await apiError({ res }, 400, 'Bad input', { details: { field: 'title' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(bodyOf(res), { error: 'bad_request', message: 'Bad input', details: { field: 'title' } });
});

// ---------------------------------------------------------------------------
// The wrap — every v1 handler answers a throw in this envelope
// ---------------------------------------------------------------------------

test('withV1ErrorHandler turns an unexpected throw into a generic 500, no leak, no `ok`', async () => {
  const res = makeRes();
  const wrapped = withV1ErrorHandler('test', async () => {
    throw new Error('secret internal detail that must not leak');
  });
  const handled = await wrapped({ res, req: { method: 'GET' }, url: new URL('http://x/api/v1/boom') });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 500);
  const body = bodyOf(res);
  assert.deepEqual(body, { error: 'internal_error', message: 'Internal server error' });
  assert.ok(!String(res.body).includes('secret internal detail'), 'the thrown message never reaches the client');
  assert.ok(!('ok' in body));
});

test('withV1ErrorHandler preserves an AppError status, machine code and details', async () => {
  const res = makeRes();
  const wrapped = withV1ErrorHandler('test', async () => {
    throw new LockedError('Slide is locked', { slideId: 's1', lockKind: 'author' });
  });
  await wrapped({ res, req: { method: 'PUT' }, url: new URL('http://x/api/v1/x') });
  assert.equal(res.statusCode, 423);
  assert.deepEqual(bodyOf(res), {
    error: 'locked',
    message: 'Slide is locked',
    details: { slideId: 's1', lockKind: 'author' },
  });
});

test('withV1ErrorHandler keeps a 4xx AppError message (only 5xx is made generic)', async () => {
  const res = makeRes();
  const wrapped = withV1ErrorHandler('test', async () => {
    throw new ValidationError('targetLang is required');
  });
  await wrapped({ res, req: { method: 'POST' }, url: new URL('http://x/api/v1/x') });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(bodyOf(res), { error: 'bad_request', message: 'targetLang is required' });
});

test('withV1ErrorHandler maps a bare statusCode-bearing throw by status', async () => {
  const res = makeRes();
  const wrapped = withV1ErrorHandler('test', async () => {
    const e = new Error('upstream boom');
    e.statusCode = 502;
    throw e;
  });
  await wrapped({ res, req: { method: 'POST' }, url: new URL('http://x/api/v1/ai/wizard') });
  // 5xx → generic, and 502 resolves to bad_gateway via the shared status map.
  assert.deepEqual(bodyOf(res), { error: 'bad_gateway', message: 'Internal server error' });
});

test('withV1ErrorHandler does not double-answer once headers are flushed', async () => {
  const res = makeRes();
  res.writeHead(200, { 'Content-Type': 'text/html' }); // simulate a streaming export that began
  const wrapped = withV1ErrorHandler('test', async () => {
    throw new Error('boom mid-stream');
  });
  await wrapped({ res, req: { method: 'GET' }, url: new URL('http://x/api/v1/x') });
  assert.equal(res.statusCode, 200, 'the already-sent status is untouched');
  assert.equal(res.body, null, 'no error envelope is written over a flushed stream');
});

test('withV1ErrorHandler passes a normal return value through unchanged', async () => {
  const res = makeRes();
  const wrapped = withV1ErrorHandler('test', async () => false);
  assert.equal(await wrapped({ res, req: {}, url: new URL('http://x/api/v1/x') }), false);
  assert.equal(res.statusCode, null, 'no response written when the handler did not match');
});

// ---------------------------------------------------------------------------
// Source gate — every feature module entry is withV1ErrorHandler-wrapped
// ---------------------------------------------------------------------------

test('every feature handler mounted in the v1 router is withV1ErrorHandler-wrapped', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const v1Dir = path.resolve(dir, '../server/routes/public-api/v1');
  const indexSrc = readFileSync(path.join(v1Dir, 'index.js'), 'utf8');

  // Feature handlers the router dispatches to: `import { handleX } from './x.js';`
  const re = /import\s*\{\s*(handle\w+)\s*\}\s*from\s*'(\.\/[\w-]+\.js)';/g;
  const entries = [...indexSrc.matchAll(re)].map((m) => ({ name: m[1], file: m[2] }));
  assert.ok(entries.length >= 9, `expected the feature handler imports, saw ${entries.length}`);

  const unwrapped = [];
  for (const { name, file } of entries) {
    const src = readFileSync(path.join(v1Dir, file), 'utf8');
    const wrapped = new RegExp(`export const ${name} = withV1ErrorHandler\\(`);
    if (!wrapped.test(src)) unwrapped.push(`${name} (${file})`);
  }
  assert.deepEqual(unwrapped, [], `these v1 module entries must be withV1ErrorHandler-wrapped:\n  ${unwrapped.join('\n  ')}`);

  // The router entry itself is wrapped too: a throw from the pre-dispatch
  // phase (auth, rate limiting, meta endpoints) must answer the v1 envelope,
  // not the internal one the outer /api dispatcher would emit.
  assert.match(
    indexSrc,
    /export const handlePublicApiV1 = withV1ErrorHandler\(/,
    'the v1 router entry (handlePublicApiV1) must be withV1ErrorHandler-wrapped'
  );
});

// ---------------------------------------------------------------------------
// Above the mount — the maintenance write refusal keys on the surface
// ---------------------------------------------------------------------------

test('a maintenance write refusal on /api/v1 answers the v1 envelope; internal keeps ok:false', async (t) => {
  t.after(() => resetMaintenanceForTests());
  setMaintenanceActive(true, { reason: 'deploy' });

  // Storage-free: the refusal happens before any auth or storage call.
  const v1 = makeRes();
  await handleApi({
    repoRoot: '/tmp',
    req: { method: 'POST', headers: {} },
    res: v1,
    url: new URL('http://x/api/v1/presentations'),
  });
  assert.equal(v1.statusCode, 503);
  const v1Body = bodyOf(v1);
  assert.equal(v1Body.error, 'maintenance');
  assert.ok(!('ok' in v1Body), 'the v1 surface never carries the internal `ok` discriminator');
  assert.ok(v1.headers['Retry-After'], 'the refusal names a retry moment');

  const internal = makeRes();
  await handleApi({
    repoRoot: '/tmp',
    req: { method: 'POST', headers: {} },
    res: internal,
    url: new URL('http://x/api/presentations'),
  });
  assert.equal(internal.statusCode, 503);
  const internalBody = bodyOf(internal);
  assert.equal(internalBody.ok, false, 'the internal surface keeps its own envelope');
  assert.equal(internalBody.error, 'maintenance');
});
