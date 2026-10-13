/**
 * The last storage exports take `scope` first (B665 cluster 4).
 *
 * Retention sweeps accept only a reasoned instance scope (storage-scope.md
 * category 7) and refuse any scope that names an organization, seed-theme
 * reads accept an organization scope or a reasoned instance scope (category
 * 3), and the tag-replacement and user-id helpers derive their organization
 * from the scope instead of a loose `orgId`. Every one refuses a missing scope
 * before it queries.
 *
 * Run with: node --test tests/storage-scope-infrastructure.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { seedRow } = await import('./helpers/theme-seed.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { __setTestDb, getDb } = await import('../server/db/client.js');
const { crossOrganizationScope } = await import('../server/storage/scope.js');
const { deleteOldActivityEvents } =
  await import('../server/storage/activity-events.js');
const { cleanupExpiredSlideLocks } =
  await import('../server/storage/slide-locks.js');
const { listSeedThemes } = await import('../server/storage/themes.js');
const { resolveSeedThemeSlug, installationDefaultThemeId } =
  await import('../server/storage/settings.js');
const { replaceTagLinks } = await import('../server/storage/tags.js');
const { getUserIdByEmail } = await import('../server/storage/utils/index.js');

const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const ORG_B = '00000000-0000-0000-0000-0000000000bb';
const orgScope = (organizationId) => ({ repoRoot: null, organizationId });
const retention = crossOrganizationScope(null, 'test: instance retention');
const instance = crossOrganizationScope(null, 'test: instance configuration');

test.afterEach(() => {
  __setTestDb(null);
});

test('retention sweeps refuse a missing or organization scope', async () => {
  __setTestDb(createFakeDb({ activity_events: [], slide_locks: [] }));
  const past = new Date().toISOString();
  await assert.rejects(deleteOldActivityEvents(undefined, past), TypeError);
  await assert.rejects(deleteOldActivityEvents(past), TypeError);
  await assert.rejects(
    deleteOldActivityEvents(orgScope(ORG_A), past),
    /requires an instance retention scope/,
  );
  await assert.rejects(cleanupExpiredSlideLocks(), TypeError);
  await assert.rejects(
    cleanupExpiredSlideLocks(orgScope(ORG_A)),
    /requires an instance retention scope/,
  );
  // A reason beside an organization is still an organization scope.
  const reasonedOrg = { ...orgScope(ORG_A), crossOrganization: 'test: both' };
  await assert.rejects(
    deleteOldActivityEvents(reasonedOrg, past),
    /requires an instance retention scope/,
  );
  await assert.rejects(
    cleanupExpiredSlideLocks(reasonedOrg),
    /requires an instance retention scope/,
  );
});

test('retention sweeps delete across organizations under an instance scope', async () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  const later = new Date(Date.now() + 60_000).toISOString();
  __setTestDb(
    createFakeDb({
      activity_events: [
        { id: 'a', organization_id: ORG_A, created_at: old },
        { id: 'b', organization_id: ORG_B, created_at: old },
        { id: 'c', organization_id: ORG_A, created_at: later },
      ],
      slide_locks: [
        { id: 'l1', organization_id: ORG_A, expires_at: old },
        { id: 'l2', organization_id: ORG_B, expires_at: old },
        { id: 'l3', organization_id: ORG_B, expires_at: later },
      ],
    }),
  );
  const cutoff = new Date().toISOString();
  assert.deepEqual(await deleteOldActivityEvents(retention, cutoff), {
    deleted: 2,
  });
  assert.equal(await cleanupExpiredSlideLocks(retention), 2);
  const db = getDb();
  const events = await db.selectFrom('activity_events').select('id').execute();
  const locks = await db.selectFrom('slide_locks').select('id').execute();
  assert.deepEqual(
    events.map((row) => row.id),
    ['c'],
  );
  assert.deepEqual(
    locks.map((row) => row.id),
    ['l3'],
  );
});

test('seed-theme reads refuse a missing scope and answer the same seeds under either scope', async () => {
  __setTestDb(
    createFakeDb({
      themes: [await seedRow('brand'), await seedRow('midnight')],
    }),
  );
  await assert.rejects(listSeedThemes(), TypeError);
  await assert.rejects(resolveSeedThemeSlug('midnight'), TypeError);
  await assert.rejects(installationDefaultThemeId(), TypeError);

  const viaOrg = await listSeedThemes(testScope());
  const viaInstance = await listSeedThemes(instance);
  assert.deepEqual(
    viaOrg.map((theme) => theme.id),
    viaInstance.map((theme) => theme.id),
  );
  assert.equal(viaOrg.length, 2);
  const midnight = viaOrg.find((theme) => theme.slug === 'midnight');
  assert.equal(await resolveSeedThemeSlug(instance, 'midnight'), midnight.id);
  assert.equal(
    await resolveSeedThemeSlug(testScope(), 'midnight'),
    midnight.id,
  );
  const brand = viaOrg.find((theme) => theme.slug === 'brand');
  assert.equal(await installationDefaultThemeId(instance), brand.id);
});

test('replaceTagLinks takes its organization from the scope and refuses none', async () => {
  __setTestDb(createFakeDb({}));
  await assert.rejects(
    replaceTagLinks(
      { linkTable: 'presentation_tags', rowId: 'deck', tagNames: [] },
      undefined,
    ),
    TypeError,
  );
  await assert.rejects(
    replaceTagLinks(instance, {
      linkTable: 'presentation_tags',
      rowId: 'deck',
      tagNames: [],
    }),
    /cannot run cross-organization/,
  );
});

test('getUserIdByEmail resolves within the scope organization only', async () => {
  const db = createFakeDb({
    users: [
      { id: 'user-a', organization_id: ORG_A, email: 'ann@example.com' },
      { id: 'user-b', organization_id: ORG_B, email: 'bob@example.com' },
    ],
  });
  await assert.rejects(
    getUserIdByEmail(undefined, db, 'ann@example.com'),
    TypeError,
  );
  assert.equal(
    await getUserIdByEmail(orgScope(ORG_A), db, 'ann@example.com'),
    'user-a',
  );
  assert.equal(
    await getUserIdByEmail(orgScope(ORG_A), db, 'bob@example.com'),
    null,
  );
});
