import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  pgDescribe,
  openTestDb,
  closeTestDb,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope, otherOrganizationScope } from '../helpers/storage-scope.js';
import {
  initializeThemeSeeds,
  readThemeSeeds,
  upsertThemeSeeds,
} from '../../server/utils/theme-seeds.js';
import {
  createTheme,
  deleteTheme,
  getThemeRecord,
  listThemes,
  updateTheme,
} from '../../server/storage/themes.js';

pgDescribe('theme seeds and scope (real PostgreSQL)', () => {
  let db;
  let orgA;
  const orgB = randomUUID();
  const scopeA = testScope();
  const scopeB = otherOrganizationScope(null, orgB);

  before(async () => {
    db = await openTestDb();
    await truncate(db, 'organizations');
    await truncate(db, 'themes');
    orgA = await seedDefaultOrganization(db);
    await db
      .insertInto('organizations')
      .values({ id: orgB, name: 'Other', slug: 'other-theme-test' })
      .execute();
  });
  after(async () => {
    await closeTestDb(db);
  });

  it('boots six seeds, keeps UUIDs and updates a changed seed in place', async () => {
    await initializeThemeSeeds();
    const first = await db
      .selectFrom('themes')
      .selectAll()
      .where('organization_id', 'is', null)
      .execute();
    assert.equal(first.length, 6);
    await initializeThemeSeeds();
    const second = await db
      .selectFrom('themes')
      .selectAll()
      .where('organization_id', 'is', null)
      .execute();
    assert.deepEqual(
      second.map((r) => r.id).sort(),
      first.map((r) => r.id).sort(),
    );
    const seeds = await readThemeSeeds();
    const changed = {
      ...seeds[0],
      record: { ...seeds[0].record, label: 'Changed label' },
      hash: 'changed-hash',
    };
    await upsertThemeSeeds(db, [changed]);
    const row = await db
      .selectFrom('themes')
      .select(['id', 'label'])
      .where('slug', '=', changed.record.slug)
      .where('organization_id', 'is', null)
      .executeTakeFirstOrThrow();
    assert.equal(row.id, first.find((r) => r.slug === changed.record.slug).id);
    assert.equal(row.label, 'Changed label');
    await initializeThemeSeeds();
  });

  it('keeps seed and org scope distinct at the database boundary', async () => {
    const seed = (await readThemeSeeds())[0].record;
    await assert.rejects(
      db
        .insertInto('themes')
        .values({ slug: seed.slug, label: 'Duplicate', seed_hash: 'x' })
        .execute(),
      /idx_themes_seed_slug/,
    );
    await assert.rejects(
      db
        .insertInto('themes')
        .values({ slug: 'bad-scope', label: 'Bad' })
        .execute(),
      /themes_seed_scope_check/,
    );
    await assert.rejects(
      db
        .insertInto('themes')
        .values({
          organization_id: orgA,
          slug: 'bad-scope',
          label: 'Bad',
          seed_hash: 'x',
        })
        .execute(),
      /themes_seed_scope_check/,
    );
    const rows =
      await sql`SELECT COUNT(*)::int AS count FROM themes WHERE organization_id IS NULL`.execute(
        db,
      );
    assert.equal(rows.rows[0].count, 6);
  });

  it('shows seeds to both organizations but only own records; seeds are read-only', async () => {
    const seed = (await listThemes(scopeA)).find((row) => !row.organizationId);
    assert.ok(seed);
    const copyA = await createTheme(scopeA, {
      ...seed,
      slug: 'org-a-copy',
      id: undefined,
      isDefault: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      createdBy: undefined,
      organizationId: undefined,
    });
    // The public create accepts only the portable fields, not the read shape.
    assert.equal(copyA.ok, false);
    const record = (await readThemeSeeds())[0].record;
    const a = await createTheme(scopeA, { ...record, slug: 'org-a-copy' });
    const b = await createTheme(scopeB, { ...record, slug: 'org-b-copy' });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal((await listThemes(scopeA)).length, 7);
    assert.equal((await listThemes(scopeB)).length, 7);
    assert.equal(await getThemeRecord(scopeB, a.theme.id), null);
    assert.ok(await getThemeRecord(scopeB, seed.id));
    assert.deepEqual(
      (await updateTheme(scopeA, seed.id, { label: 'No' })).reason,
      'not_found',
    );
    assert.deepEqual((await deleteTheme(scopeA, seed.id)).reason, 'not_found');
  });
});
