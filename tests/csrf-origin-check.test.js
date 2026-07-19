import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCsrfSafe } from '../server/utils/csrf.js';

/**
 * Security hardening 5c: reject cookie-authenticated cross-origin
 * state-changing requests; leave everything else working.
 */

function req({ method = 'POST', host = 'app.example.com', cookie, origin, referer } = {}) {
  const headers = { host };
  if (cookie !== undefined) headers.cookie = cookie;
  if (origin !== undefined) headers.origin = origin;
  if (referer !== undefined) headers.referer = referer;
  return { method, headers };
}

const SESSION = 'sb_session=abc.def';

test('safe methods are always allowed', () => {
  assert.equal(
    isCsrfSafe(req({ method: 'GET', cookie: SESSION, origin: 'https://evil.com' })),
    true
  );
});

test('no session cookie → allowed (not CSRF-able)', () => {
  assert.equal(isCsrfSafe(req({ origin: 'https://evil.com' })), true);
});

test('cookie + same-origin → allowed', () => {
  assert.equal(
    isCsrfSafe(req({ cookie: SESSION, origin: 'https://app.example.com' })),
    true
  );
});

test('cookie + cross-origin → blocked', () => {
  assert.equal(
    isCsrfSafe(req({ cookie: SESSION, origin: 'https://evil.com' })),
    false
  );
});

test('cookie + no Origin/Referer → allowed (non-browser client)', () => {
  assert.equal(isCsrfSafe(req({ cookie: SESSION })), true);
});

test('cookie + cross-origin Referer (no Origin) → blocked', () => {
  assert.equal(
    isCsrfSafe(req({ cookie: SESSION, referer: 'https://evil.com/x' })),
    false
  );
});

test('cookie + same-origin Referer → allowed', () => {
  assert.equal(
    isCsrfSafe(req({ cookie: SESSION, referer: 'https://app.example.com/deck' })),
    true
  );
});

test('Origin matching APP_URL host (behind proxy, different Host) → allowed', () => {
  const saved = process.env.APP_URL;
  process.env.APP_URL = 'https://slides.example.com';
  try {
    assert.equal(
      isCsrfSafe(
        req({ host: 'localhost:4177', cookie: SESSION, origin: 'https://slides.example.com' })
      ),
      true
    );
  } finally {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  }
});

test('sandbox-guest cookie + cross-origin → blocked (CSRF-able like sb_session)', () => {
  assert.equal(
    isCsrfSafe(req({ cookie: 'sb_sandbox=guest-token', origin: 'https://evil.com' })),
    false
  );
});

test('sandbox-guest cookie + same-origin → allowed', () => {
  assert.equal(
    isCsrfSafe(req({ cookie: 'sb_sandbox=guest-token', origin: 'https://app.example.com' })),
    true
  );
});

test('CSRF_ALLOWED_ORIGINS extends the allowlist', () => {
  const saved = process.env.CSRF_ALLOWED_ORIGINS;
  process.env.CSRF_ALLOWED_ORIGINS = 'https://embed.partner.com';
  try {
    assert.equal(
      isCsrfSafe(req({ cookie: SESSION, origin: 'https://embed.partner.com' })),
      true
    );
  } finally {
    if (saved === undefined) delete process.env.CSRF_ALLOWED_ORIGINS;
    else process.env.CSRF_ALLOWED_ORIGINS = saved;
  }
});
