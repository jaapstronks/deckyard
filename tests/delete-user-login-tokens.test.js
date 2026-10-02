/**
 * Deleting a user takes their pending login tokens with them (B546).
 *
 * `deleteUser` used to clear `password_reset_tokens` only. A magic link issued
 * before the delete stayed redeemable for its fifteen minutes, and redeeming it
 * ran `getOrCreateMagicLinkUser`, which recreated the `users` row (and under
 * multi-organization mode a membership). Both token tables are keyed on the
 * email address, so both go when the row goes.
 *
 * Run with: node --test tests/delete-user-login-tokens.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.MULTI_ORG_ENABLED;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const EMAIL = 'alice@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const magicLinkStore = await import('../server/storage/magic-link.js');
const usersStore = await import('../server/storage/users.js');

const ctx = { organizationId: ORG, actorEmail: 'admin@example.com' };

test.afterEach(() => {
  __setTestDb(null);
});

function seed() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: 'user-alice',
        organization_id: ORG,
        email: EMAIL,
        name: 'Alice',
        role: 'user',
        auth_source: 'magic_link',
        updated_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      },
    ],
    password_reset_tokens: [
      {
        id: 'reset-alice',
        user_email: EMAIL,
        token_hash: 'reset-hash',
        expires_at: '2999-01-01T00:00:00.000Z',
        used_at: null,
      },
    ],
  });
  __setTestDb(db);
  return db;
}

test('a magic link issued before deleteUser no longer signs in', async () => {
  const db = seed();
  const issued = await magicLinkStore.createMagicToken(EMAIL);
  assert.equal(issued.ok, true);

  const deleted = await usersStore.deleteUser(ctx, 'user-alice');
  assert.equal(deleted.ok, true);

  const consumed = await magicLinkStore.consumeMagicToken(issued.token);
  assert.equal(consumed.ok, false);
  assert.equal(consumed.reason, 'invalid_or_expired');
  assert.equal(db.__tables.users.length, 0, 'no users row is recreated');
});

test('deleteUser clears both login-token tables for the address', async () => {
  const db = seed();
  await magicLinkStore.createMagicToken(EMAIL);

  await usersStore.deleteUser(ctx, 'user-alice');

  assert.deepEqual(db.__tables.password_reset_tokens, []);
  assert.deepEqual(db.__tables.magic_link_tokens, []);
});

test("deleteUser leaves another address's tokens alone", async () => {
  const db = seed();
  await magicLinkStore.createMagicToken('bob@example.com');

  await usersStore.deleteUser(ctx, 'user-alice');

  assert.equal(db.__tables.magic_link_tokens.length, 1);
  assert.equal(db.__tables.magic_link_tokens[0].user_email, 'bob@example.com');
});
