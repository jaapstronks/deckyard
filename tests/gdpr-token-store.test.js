/**
 * The GDPR self-service verification token store (server/storage/gdpr-tokens.js).
 *
 * The lead my-data flow proves an anonymous data subject owns an address by
 * mailing them a short-lived token, then checking it on GET/DELETE. This used to
 * be an in-process `Map`; it is now a DB row (`gdpr_verification_tokens`,
 * migration 075), so a token survives a restart and validates across a scaled
 * deployment — the same shape as the analytics track-erase token.
 *
 * Four rules carry the store and are stated here as assertions:
 *
 *   1. **A stored token verifies; a wrong or absent one does not.** The compare
 *      is constant-time, and a length mismatch must return false rather than
 *      throw (the naive `timingSafeEqual` hazard).
 *   2. **An expired token is dead.** Verification checks the expiry, so a token
 *      past its window never validates even though the row still exists.
 *   3. **One active token per address.** A second `storeGdprToken` upserts over
 *      the first, so only the latest token validates.
 *   4. **Consume burns it.** After `consumeGdprToken`, the token no longer
 *      verifies; `deleteExpiredGdprTokens` removes only expired rows.
 *
 * House shape: the storage functions are called directly over
 * `tests/helpers/fake-db.js`. No HTTP server, no browser.
 *
 * Run with: node --test tests/gdpr-token-store.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const {
  storeGdprToken,
  verifyGdprToken,
  consumeGdprToken,
  deleteExpiredGdprTokens,
} = await import('../server/storage/gdpr-tokens.js');

const EMAIL = 'subject@example.com';
const TOKEN = 'a'.repeat(64);

function freshDb() {
  __setTestDb(createFakeDb({}));
}

test.after(() => __setTestDb(null));

test('a stored token verifies; a wrong or wrong-length token does not', async () => {
  freshDb();
  await storeGdprToken({ email: EMAIL, token: TOKEN, expiresAt: Date.now() + 60_000 });

  assert.equal(await verifyGdprToken({ email: EMAIL, token: TOKEN }), true, 'the exact token matches');
  assert.equal(
    await verifyGdprToken({ email: EMAIL, token: 'b'.repeat(64) }),
    false,
    'a same-length wrong token is refused'
  );
  // The constant-time compare must not throw on a length mismatch — the classic
  // timingSafeEqual footgun. A short token is simply false.
  assert.equal(
    await verifyGdprToken({ email: EMAIL, token: 'short' }),
    false,
    'a wrong-length token is refused, not an error'
  );
  assert.equal(await verifyGdprToken({ email: EMAIL, token: '' }), false, 'an empty token is refused');
  assert.equal(
    await verifyGdprToken({ email: 'nobody@example.com', token: TOKEN }),
    false,
    'an address with no token is refused'
  );
});

test('an expired token never validates, even though the row survives', async () => {
  freshDb();
  await storeGdprToken({ email: EMAIL, token: TOKEN, expiresAt: Date.now() - 1 });
  assert.equal(await verifyGdprToken({ email: EMAIL, token: TOKEN }), false, 'past its window it is dead');
});

test('a second store replaces the first: one active token per address', async () => {
  freshDb();
  const OLD = 'c'.repeat(64);
  const NEW = 'd'.repeat(64);
  await storeGdprToken({ email: EMAIL, token: OLD, expiresAt: Date.now() + 60_000 });
  await storeGdprToken({ email: EMAIL, token: NEW, expiresAt: Date.now() + 60_000 });

  assert.equal(await verifyGdprToken({ email: EMAIL, token: OLD }), false, 'the superseded token is gone');
  assert.equal(await verifyGdprToken({ email: EMAIL, token: NEW }), true, 'only the latest validates');
});

test('consume burns the token; the sweep removes only expired rows', async () => {
  freshDb();
  await storeGdprToken({ email: EMAIL, token: TOKEN, expiresAt: Date.now() + 60_000 });
  await consumeGdprToken(EMAIL);
  assert.equal(await verifyGdprToken({ email: EMAIL, token: TOKEN }), false, 'a consumed token is dead');

  // A live token and an expired one; the sweep drops only the expired.
  await storeGdprToken({ email: 'live@example.com', token: TOKEN, expiresAt: Date.now() + 60_000 });
  await storeGdprToken({ email: 'stale@example.com', token: TOKEN, expiresAt: Date.now() - 1 });
  await deleteExpiredGdprTokens();
  assert.equal(await verifyGdprToken({ email: 'live@example.com', token: TOKEN }), true, 'the live token survives the sweep');
  assert.equal(await verifyGdprToken({ email: 'stale@example.com', token: TOKEN }), false, 'the expired row is swept');
});
