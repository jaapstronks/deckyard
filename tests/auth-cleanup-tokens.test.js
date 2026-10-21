/**
 * Login tokens age out: the auth cleanup removes expired magic-link and
 * password-reset tokens and keeps live ones (B786 register evidence).
 *
 * `magic_link_tokens` and `password_reset_tokens` carry the IP and user agent
 * of the request that asked for the link. Their lifetime is the token's
 * `expires_at`: `server/jobs/auth-cleanup.js` calls both storage sweeps every
 * hour. `tests/pg/cleanup-jobs.pgtest.js` runs the job itself against
 * PostgreSQL; this file pins the two storage seams on the in-memory double so
 * the lifetime is part of `npm test`.
 *
 * Run with: node --test tests/auth-cleanup-tokens.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { cleanupExpiredTokens: cleanupMagicLinkTokens } =
  await import('../server/storage/magic-link.js');
const { cleanupExpiredTokens: cleanupPasswordResetTokens } =
  await import('../server/storage/password-reset.js');

const HOUR_MS = 60 * 60 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

function token(id, expiresAt) {
  return {
    id,
    user_email: 'person@example.com',
    token_hash: `hash-${id}`,
    expires_at: expiresAt,
    used_at: null,
    ip_address: '203.0.113.7',
    user_agent: 'Mozilla/5.0 (test)',
  };
}

test.afterEach(() => {
  __setTestDb(null);
});

test('expired magic-link tokens go, live ones stay, with their IP and user agent', async () => {
  const db = createFakeDb({
    magic_link_tokens: [
      token('expired', iso(-HOUR_MS)),
      token('live', iso(HOUR_MS)),
    ],
  });
  __setTestDb(db);

  assert.equal(await cleanupMagicLinkTokens(), 1);
  assert.deepEqual(
    db.__tables.magic_link_tokens.map((r) => r.id),
    ['live'],
  );
  assert.equal(await cleanupMagicLinkTokens(), 0, 'idempotent');
});

test('expired password-reset tokens go, live ones stay', async () => {
  const db = createFakeDb({
    password_reset_tokens: [
      token('expired-a', iso(-2 * HOUR_MS)),
      token('expired-b', iso(-HOUR_MS)),
      token('live', iso(HOUR_MS)),
    ],
  });
  __setTestDb(db);

  assert.equal(await cleanupPasswordResetTokens(), 2);
  assert.deepEqual(
    db.__tables.password_reset_tokens.map((r) => r.id),
    ['live'],
  );
});

test('each sweep touches its own table only', async () => {
  const db = createFakeDb({
    magic_link_tokens: [token('m-expired', iso(-HOUR_MS))],
    password_reset_tokens: [token('p-expired', iso(-HOUR_MS))],
  });
  __setTestDb(db);

  assert.equal(await cleanupMagicLinkTokens(), 1);
  assert.equal(db.__tables.password_reset_tokens.length, 1);
  assert.equal(await cleanupPasswordResetTokens(), 1);
  assert.deepEqual(db.__tables.magic_link_tokens, []);
  assert.deepEqual(db.__tables.password_reset_tokens, []);
});
