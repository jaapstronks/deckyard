/**
 * Security-audit cluster 3 regression tests (H6, H7, H8).
 *
 * H6 — the unauthenticated /embed/:publishId render-failure page leaked the
 *      server error message + full stack (`server/routes/static.js`). Gated
 *      behind non-production now.
 * H7 — the JSON/markdown import endpoints returned `err.message` + `err.stack`
 *      in the 500 body (effectively public in sandbox/demo mode). Now generic.
 * H8 — no framing/clickjacking headers anywhere. A global layer now sets
 *      X-Frame-Options / X-Content-Type-Options / Referrer-Policy (and HSTS
 *      over HTTPS), keeping /embed/* frameable.
 *
 * Run with: node --test tests/security-audit-cluster3.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { applySecurityHeaders } from '../server/utils/security-headers.js';
import { handlePresentationsImportJson } from '../server/routes/api/presentations/import-json.js';
import { handlePresentationsImportMarkdown } from '../server/routes/api/presentations/import-markdown.js';

/** Minimal ServerResponse mock covering setHeader + writeHead + end. */
class MockRes {
  constructor() {
    this.headers = {};
    this.statusCode = null;
    this.chunks = [];
    this.headersSent = false;
    this.writableEnded = false;
  }
  setHeader(k, v) {
    this.headers[String(k).toLowerCase()] = v;
  }
  getHeader(k) {
    return this.headers[String(k).toLowerCase()];
  }
  writeHead(status, headers) {
    this.statusCode = status;
    this.headersSent = true;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        this.headers[String(k).toLowerCase()] = v;
      }
    }
    return this;
  }
  end(chunk) {
    if (chunk != null) this.chunks.push(Buffer.from(chunk));
    this.writableEnded = true;
  }
  bodyText() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

// ============================================================================
// H8 — global security headers
// ============================================================================

test('H8: app pages get frame/nosniff/referrer headers', () => {
  const res = new MockRes();
  applySecurityHeaders({ headers: {} }, res, '/app');
  assert.equal(res.getHeader('X-Frame-Options'), 'DENY');
  assert.equal(res.getHeader('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.getHeader('Referrer-Policy'), 'strict-origin-when-cross-origin');
});

test('H8: /embed/* stays frameable (no X-Frame-Options) but keeps nosniff/referrer', () => {
  const res = new MockRes();
  applySecurityHeaders({ headers: {} }, res, '/embed/abc123');
  assert.equal(res.getHeader('X-Frame-Options'), undefined, 'embed must remain frameable');
  assert.equal(res.getHeader('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.getHeader('Referrer-Policy'), 'strict-origin-when-cross-origin');
});

test('H8: HSTS only when the connection is secure', () => {
  const insecure = new MockRes();
  applySecurityHeaders({ headers: {} }, insecure, '/app');
  assert.equal(insecure.getHeader('Strict-Transport-Security'), undefined);

  const prev = process.env.SECURE_COOKIES;
  process.env.SECURE_COOKIES = 'true';
  try {
    const secure = new MockRes();
    applySecurityHeaders({ headers: {} }, secure, '/app');
    assert.match(secure.getHeader('Strict-Transport-Security') || '', /max-age=\d+/);
  } finally {
    if (prev === undefined) delete process.env.SECURE_COOKIES;
    else process.env.SECURE_COOKIES = prev;
  }
});

// ============================================================================
// H7 — import endpoints must not leak err.message / err.stack
// ============================================================================

function badJsonReq() {
  return Readable.from([Buffer.from('{ this is : not valid json')]);
}

test('H7: JSON import 500 is generic (no stack, no raw message)', async () => {
  const res = new MockRes();
  await handlePresentationsImportJson({
    repoRoot: '/tmp',
    req: badJsonReq(),
    res,
    authedUser: { email: 'a@b.com' },
  });
  assert.equal(res.statusCode, 500);
  const body = JSON.parse(res.bodyText());
  assert.equal(body.error, 'internal_error');
  assert.equal(body.message, 'Internal server error', 'generic message, no leak');
  assert.ok(!('stack' in body), 'stack must not be in the response');
  assert.doesNotMatch(res.bodyText(), /Invalid JSON body/, 'raw error message must not leak');
});

test('H7: markdown import 500 is generic (no stack, no raw message)', async () => {
  const res = new MockRes();
  await handlePresentationsImportMarkdown({
    repoRoot: '/tmp',
    req: badJsonReq(),
    res,
    authedUser: { email: 'a@b.com' },
  });
  assert.equal(res.statusCode, 500);
  const body = JSON.parse(res.bodyText());
  assert.equal(body.error, 'internal_error');
  assert.equal(body.message, 'Internal server error', 'generic message, no leak');
  assert.ok(!('stack' in body), 'stack must not be in the response');
});

// ============================================================================
// H6 — embed error page gates message + stack behind non-production
// ============================================================================

test('H6: embed render-failure message + stack are gated behind isDev', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../server/routes/static.js', import.meta.url)),
    'utf8',
  );
  // The error message line must only render in dev.
  assert.match(
    src,
    /isDev\s*\?\s*`<p class="help">Foutmelding/,
    'embed error message must be dev-gated',
  );
  // The stack <details> block must require isDev (and a stack) — the condition
  // driving it is `isDev && stackRaw`, so a stack can never render in prod.
  assert.match(
    src,
    /isDev\s*&&\s*stackRaw/,
    'embed stack block must be dev-gated',
  );
});
