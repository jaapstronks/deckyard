/**
 * The dev-bypass identity is a valid address, so the bypass can use the app.
 *
 * `AUTH_DEV_BYPASS=true` signs every request in as one database user. That
 * user's address was `dev@local` — single-label, no dot in the domain, which
 * `validateEmail` (`server/utils/secure-tokens.js`) rejects. Anything that
 * validates an address therefore refused the one identity a bypass machine
 * has; `createApiKey` most visibly, which left the whole public-API surface
 * untestable locally (D55, 2026-08-22).
 *
 * The fix is the address, not the validator: loosening `validateEmail` would
 * weaken every real registration, magic-link and reset path, and an exception
 * inside `createApiKey` would put auth knowledge in the storage layer. `.test`
 * is reserved by RFC 2606, so `dev@local.test` stays synthetic and never
 * resolves.
 *
 * This file pins the property that matters — the bypass identity passes the
 * validator and can create a key — rather than the literal string, plus the
 * one assertion on the literal that explains why it changed.
 *
 * Run with: node --test tests/dev-bypass-identity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { DEV_BYPASS_EMAIL, resolveDevBypassUserId, resetDevBypassUserCache } =
  await import('../server/auth/dev-bypass.js');
const { validateEmail } = await import('../server/utils/secure-tokens.js');
const { createApiKey } = await import('../server/storage/api-keys.js');
const { singleOrganizationScope } = await import('../server/storage/scope.js');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  resetDevBypassUserCache();
});

test('the bypass address passes the validator every surface uses', () => {
  assert.deepEqual(validateEmail(DEV_BYPASS_EMAIL), { valid: true });
  // Why it changed: a single-label domain has no TLD to validate.
  assert.equal(validateEmail('dev@local').valid, false);
  assert.equal(validateEmail('dev@local').reason, 'missing_tld');
});

test('the bypass identity can create an API key', async () => {
  resetDevBypassUserCache();
  const userId = await resolveDevBypassUserId();
  assert.equal(typeof userId, 'string', 'the bypass resolves to a users row');
  assert.equal(
    db.__tables.users.find((u) => u.id === userId).email,
    DEV_BYPASS_EMAIL,
    'the row it created carries the bypass address',
  );

  const result = await createApiKey(
    singleOrganizationScope(process.cwd(), 'tests/dev-bypass-identity.test.js', {
      actorEmail: DEV_BYPASS_EMAIL,
    }),
    { name: 'Dev key', ownerEmail: DEV_BYPASS_EMAIL },
  );

  assert.equal(result.ok, true, `key creation failed: ${result.reason}`);
  assert.equal(
    db.__tables.api_keys.at(-1).owner_email,
    DEV_BYPASS_EMAIL,
    'the key belongs to the bypass identity',
  );
});
