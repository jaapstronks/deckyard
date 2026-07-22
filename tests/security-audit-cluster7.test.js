/**
 * Security-audit cluster 7 regression tests (LOW batch: L2, L4, L5, L6, L7, L8).
 *
 * L2 — no log redaction. redactSecret keeps only a short prefix; follow-code
 *      values and session tokens are no longer logged in full.
 * L4 — top-level error handler echoed raw err.message (path/SQL leak). Now only
 *      intentional sub-500 errors surface a message; unexpected errors don't.
 * L5 — weak custom-type CSS filter. Now shares filterCssText with the custom-html
 *      slide (strips @import / expression() / javascript: / </style>).
 * L6 — SSRF in font embedding. fetchFontAsDataUrl now uses the shared SSRF guard.
 * L7 — SSRF in outbound webhooks. postJson now uses the shared SSRF guard.
 * L8 — public analytics report checked the dead `settings.visibility` field
 *      instead of `scope`; source-verified below.
 *
 * Run with: node --test tests/security-audit-cluster7.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildTopLevelErrorBody } from '../server/utils/error-response.js';
import { filterCssText } from '../shared/css-filter.js';
import { redactSecret } from '../server/utils/log-redact.js';
import { fetchFontAsDataUrl } from '../server/utils/embed-fonts.js';
import { postJson } from '../server/utils/webhooks.js';

const readSrc = (rel) =>
  fs.readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// ============================================================================
// L4 — top-level error handler must not echo raw messages
// ============================================================================

test('L4: an unexpected 500 error never leaks its message', () => {
  const body = buildTopLevelErrorBody(500, new Error('ECONNREFUSED /var/run/pg.sock: SELECT * FROM users'));
  assert.equal(body.error, 'Server error');
  assert.equal(body.details, undefined, 'no details on a 500');
});

test('L4: a bare error (no statusCode) is treated as 500 with no details', () => {
  const body = buildTopLevelErrorBody(500, new Error('/etc/secret path in message'));
  assert.equal(body.error, 'Server error');
  assert.ok(!('details' in body));
});

test('L4: an intentional sub-500 error surfaces its (safe) message', () => {
  const err = new Error('Request body too large (limit 26214400 bytes)');
  err.statusCode = 413;
  const body = buildTopLevelErrorBody(413, err);
  assert.equal(body.error, 'Request error');
  assert.equal(body.details, 'Request body too large (limit 26214400 bytes)');
});

test('L4: a sub-500 status without an explicit statusCode gets no details', () => {
  // status came from elsewhere but the error itself carries no statusCode →
  // don't trust its message.
  const body = buildTopLevelErrorBody(400, new Error('raw internal detail'));
  assert.equal(body.error, 'Request error');
  assert.equal(body.details, undefined);
});

// ============================================================================
// L5 — shared author-CSS filter
// ============================================================================

test('L5: filterCssText strips @import, defangs expression()/javascript:, escapes </style>', () => {
  const dirty = `@import url('http://169.254.169.254/');
    .x { width: expression(alert(1)); background: url(javascript:alert(1)); }
    </style><script>alert(1)</script>`;
  const out = filterCssText(dirty);
  assert.doesNotMatch(out, /@import/i, '@import removed');
  assert.doesNotMatch(out, /expression\s*\(/, 'expression( defanged');
  assert.doesNotMatch(out, /javascript:/, 'javascript: defanged');
  assert.doesNotMatch(out, /<\/style/i, '</style> escaped');
});

test('L5: the custom-type runtime and custom-html slide share one filter', async () => {
  const runtime = await readSrc('../server/utils/custom-slide-type-runtime.js');
  const slide = await readSrc('../shared/slide-types/types/custom-html-slide.js');
  assert.match(runtime, /filterCssText\(ct\.css\)/, 'runtime uses filterCssText');
  assert.doesNotMatch(runtime, /function sanitizeCss/, 'weak local sanitizeCss removed');
  assert.match(slide, /from '\.\.\/\.\.\/css-filter\.js'/, 'slide imports the shared filter');
});

// ============================================================================
// L6 — font-embed SSRF guard
// ============================================================================

test('L6: fetchFontAsDataUrl rejects loopback/private/metadata/IPv6 literals', async () => {
  const blocked = [
    'http://127.0.0.1/f.woff2',
    'http://169.254.169.254/f.woff2',
    'http://[::1]/f.woff2',
    'http://[::ffff:169.254.169.254]/f.woff2',
  ];
  for (const url of blocked) {
    await assert.rejects(() => fetchFontAsDataUrl(url), /internal addresses/, url);
  }
});

test('L6: fetchFontAsDataUrl rejects non-http schemes and malformed URLs', async () => {
  await assert.rejects(() => fetchFontAsDataUrl('ftp://example.com/f.woff2'), /HTTP\(S\)/);
  await assert.rejects(() => fetchFontAsDataUrl('file:///etc/passwd'), /HTTP\(S\)/);
  await assert.rejects(() => fetchFontAsDataUrl('not-a-url'), /Invalid font URL/);
});

// ============================================================================
// L7 — webhook SSRF guard
// ============================================================================

test('L7: postJson blocks non-public webhook targets before fetching', async () => {
  for (const url of ['http://127.0.0.1/hook', 'http://[::1]/hook', 'http://169.254.169.254/']) {
    const r = await postJson(url, { hi: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'Blocked non-public webhook URL', url);
  }
});

test('L7: postJson rejects a missing URL', async () => {
  const r = await postJson('', {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Missing URL');
});

// ============================================================================
// L2 — log redaction
// ============================================================================

test('L2: redactSecret keeps only a short prefix', () => {
  assert.equal(redactSecret(''), '');
  assert.equal(redactSecret('abcd'), '***', 'short values fully masked');
  const r = redactSecret('super-secret-session-token-1234567890');
  assert.match(r, /^supe…\(\d+\)$/);
  assert.ok(!r.includes('secret-session'), 'body of the token is not present');
});

test('L2: follow-code values are no longer logged; the session token is redacted', async () => {
  const codes = await readSrc('../server/storage/follow-codes.js');
  assert.doesNotMatch(codes, /console\.log\([^)]*\$\{upperCode\}/, 'no code in resolve logs');
  assert.doesNotMatch(codes, /Looking up code/, 'verbose code lookup log removed');

  const sessions = await readSrc('../server/storage/present-sessions/sessions.js');
  assert.doesNotMatch(sessions, /nl: followCodes\.nl/, 'code values no longer logged');

  const track = await readSrc('../server/routes/api/analytics-track.js');
  assert.match(track, /redactSecret\(sessionToken\)/, 'session token redacted in logs');
});

// ============================================================================
// L8 — analytics report visibility check uses scope, not the dead field
// ============================================================================

test('L8: public analytics report gates on presentation scope, not settings.visibility', async () => {
  const src = await readSrc('../server/routes/api/analytics/public.js');
  assert.match(
    src,
    /normalizePresentationScope\(presentation\.scope\)\s*===\s*'private'/,
    'must check normalized scope',
  );
  assert.doesNotMatch(src, /settings\?\.visibility/, 'the dead visibility check is gone');
});
