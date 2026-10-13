/**
 * A deck's e-mail stamps are normalised on write (B392, D200).
 *
 * `owner_email`, `created_by` and `updated_by` are compared bare by every read
 * (`sandbox-quota.js`, the analytics dashboard and the weekly summary), so the
 * write is the one place the fold may happen. These tests drive the
 * presentations facade over tests/helpers/fake-db.js and read the stored row,
 * not the mapped presentation, because the claim is about what is in the
 * column. That the reads then find the rows from a mixed-case input is pinned
 * against real PostgreSQL in tests/pg/presentation-email-normalized.pgtest.js.
 *
 * Run with: node --test tests/presentation-email-normalized-write.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { createPresentation, updatePresentation } =
  await import('../server/storage/presentations/index.js');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: 'user-ann',
        organization_id: ORG,
        email: 'ann@example.com',
        name: 'Ann',
        role: 'user',
        auth_source: 'database',
        password_hash: null,
        settings: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
});

/** @param {string} id */
const storedRow = (id) => db.__tables.presentations.find((r) => r.id === id);

test('a create stamps owner, creator and last writer normalised', async () => {
  const pres = await createPresentation(testScope(), {
    title: 'Mixed case owner',
    ownerEmail: '  Ann@Example.COM ',
  });
  const row = storedRow(pres.id);
  assert.equal(row.owner_email, 'ann@example.com');
  assert.equal(row.created_by, 'ann@example.com');
  assert.equal(row.updated_by, 'ann@example.com');
  assert.equal(row.owner_user_id, 'user-ann', 'the id half still resolves');
});

test('a create from the actor alone normalises the actor', async () => {
  const pres = await createPresentation(
    testScope(null, { actorEmail: 'ANN@example.com' }),
    { title: 'Actor-owned' },
  );
  assert.equal(storedRow(pres.id).owner_email, 'ann@example.com');
});

test('an update stamps the last writer normalised', async () => {
  const pres = await createPresentation(testScope(), {
    title: 'Edited later',
    ownerEmail: 'ann@example.com',
  });
  await updatePresentation(
    testScope(null, { actorEmail: 'Ann@EXAMPLE.com' }),
    pres.id,
    { title: 'Edited' },
  );
  assert.equal(storedRow(pres.id).updated_by, 'ann@example.com');
});
