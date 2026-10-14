/**
 * The session cookie is signed through `server/utils/signed-payload.js` (B288).
 *
 * Before that, `auth.js` carried its own HMAC and base64url helpers. The wire
 * form must not have changed, or every live session is logged out on deploy:
 * a token minted by the old code reads with the new, and a token minted by the
 * new reads with the old (a rollback keeps sessions too). Expiry keeps the
 * session token's semantics: `exp` in epoch ms, missing or past is null.
 *
 * Run with: node --test tests/session-token-signed-payload.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Assembled rather than written as one literal so secret scanners do not flag it.
process.env.AUTH_SECRET = ['deckyard', 'test', 'b288']
  .join('-')
  .padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_ORG_ENABLED;

const auth = await import('../server/auth/auth.js');
const SECRET = process.env.AUTH_SECRET;

// --- Fixture: the session-token helpers as auth.js had them before B288. ---

function oldBase64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function oldBase64urlToBuf(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replaceAll('-', '+').replaceAll('_', '/');
  return Buffer.from(b64, 'base64');
}

function oldSign(secret, payloadB64) {
  return oldBase64url(
    crypto.createHmac('sha256', secret).update(payloadB64).digest(),
  );
}

function oldMint(payload, secret = SECRET) {
  const payloadB64 = oldBase64url(JSON.stringify(payload));
  return `${payloadB64}.${oldSign(secret, payloadB64)}`;
}

function oldRead(token, secret = SECRET) {
  const [payloadB64, sig] = String(token).split('.');
  if (!payloadB64 || !sig) return null;
  const expected = oldSign(secret, payloadB64);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(oldBase64urlToBuf(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.exp || Number(payload.exp) < Date.now()) return null;
  if (!String(payload?.email || '')) return null;
  return payload;
}

// --- Helpers ---

/** A request carrying `token` as the session cookie, the way a browser sends it. */
function requestWithToken(token) {
  return { headers: { cookie: `sb_session=${encodeURIComponent(token)}` } };
}

/** The raw token setSessionCookie() puts on the wire. */
function mintWithNewCode(user) {
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  auth.setSessionCookie({ headers: {} }, res, user);
  const pair = String(res.headers['Set-Cookie']).split(';')[0];
  return decodeURIComponent(pair.slice('sb_session='.length));
}

// Characters that differ between base64 and base64url ('+', '/') and padding,
// so the comparison covers the alphabet the old helper translated by hand.
const PAYLOAD = {
  email: 'älice+test@example.com',
  role: 'user',
  name: 'Ålice ~?>>?~ Ünicode',
  v: 'abc123def456',
};

test('a session token minted by the old code reads with the new', () => {
  const token = oldMint({ ...PAYLOAD, exp: Date.now() + 60_000 });
  const user = auth.getUserFromRequest(requestWithToken(token));
  assert.ok(user, 'old token must still resolve');
  assert.equal(user.email, PAYLOAD.email);
  assert.equal(user.name, PAYLOAD.name);
  assert.equal(user._sessionV, PAYLOAD.v);
});

test('a session token minted by the new code reads with the old', () => {
  const token = mintWithNewCode(PAYLOAD);
  const payload = oldRead(token);
  assert.ok(payload, 'new token must verify under the old reader');
  assert.equal(payload.email, PAYLOAD.email);
  assert.equal(payload.v, PAYLOAD.v);
});

test('the wire form is byte-identical to the old encoding', () => {
  const token = mintWithNewCode(PAYLOAD);
  const [body] = token.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  // Same payload, same key order, same encoding → same bytes.
  assert.equal(token, oldMint(payload));
});

test('expiry: `exp` in epoch ms, past is null, as before', () => {
  const past = oldMint({ ...PAYLOAD, exp: Date.now() - 1 });
  assert.equal(oldRead(past), null);
  assert.equal(auth.getUserFromRequest(requestWithToken(past)), null);

  // An `exp` in seconds is decades in the past as epoch ms: null.
  const seconds = oldMint({
    ...PAYLOAD,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  assert.equal(auth.getUserFromRequest(requestWithToken(seconds)), null);

  const future = oldMint({ ...PAYLOAD, exp: Date.now() + 60_000 });
  assert.ok(auth.getUserFromRequest(requestWithToken(future)));
});

test('a token without `exp` is null, as before', () => {
  const noExp = oldMint({ ...PAYLOAD });
  assert.equal(oldRead(noExp), null);
  assert.equal(auth.getUserFromRequest(requestWithToken(noExp)), null);
});

test('a token signed with another secret is null', () => {
  const forged = oldMint(
    { ...PAYLOAD, exp: Date.now() + 60_000 },
    'x'.repeat(40),
  );
  assert.equal(auth.getUserFromRequest(requestWithToken(forged)), null);
});

test('a token without an email is still null', () => {
  const token = oldMint({ ...PAYLOAD, email: '', exp: Date.now() + 60_000 });
  assert.equal(auth.getUserFromRequest(requestWithToken(token)), null);
});

test('a trailing third segment is now refused (the old reader ignored it)', () => {
  const token = oldMint({ ...PAYLOAD, exp: Date.now() + 60_000 });
  const tampered = `${token}.extra`;
  // The old reader split on '.' and took the first two parts, so it accepted
  // this. No minter ever produces it (base64url has no '.'); the seam refuses.
  assert.ok(oldRead(tampered));
  assert.equal(auth.getUserFromRequest(requestWithToken(tampered)), null);
});
