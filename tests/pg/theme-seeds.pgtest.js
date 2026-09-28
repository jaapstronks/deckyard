import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

  it('rejects a malformed seed batch before writing any changed row', async () => {
    await initializeThemeSeeds();
    const before = await db
      .selectFrom('themes')
      .select(['slug', 'label', 'seed_hash'])
      .where('organization_id', 'is', null)
      .orderBy('slug')
      .execute();
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'deckyard-bad-seeds-'),
    );
    try {
      const dir = path.join(root, 'themes');
      await fs.mkdir(dir, { recursive: true });
      const seeds = await readThemeSeeds();
      for (const { record } of seeds) {
        const changed =
          record.slug === seeds[0].record.slug
            ? { ...record, label: 'Must not be written' }
            : record.slug === seeds.at(-1).record.slug
              ? { ...record, colors: { ...record.colors, textDark: null } }
              : record;
        await fs.writeFile(
          path.join(dir, `${record.slug}.json`),
          JSON.stringify(changed),
        );
      }
      await assert.rejects(initializeThemeSeeds(root), /colors\.textDark/);
      assert.deepEqual(
        await db
          .selectFrom('themes')
          .select(['slug', 'label', 'seed_hash'])
          .where('organization_id', 'is', null)
          .orderBy('slug')
          .execute(),
        before,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a late prototype config key before changing an earlier seed', async () => {
    await initializeThemeSeeds();
    const before = await db
      .selectFrom('themes')
      .select(['slug', 'label', 'seed_hash'])
      .where('organization_id', 'is', null)
      .orderBy('slug')
      .execute();
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'deckyard-bad-config-seeds-'),
    );
    try {
      const dir = path.join(root, 'themes');
      await fs.mkdir(dir, { recursive: true });
      const seeds = await readThemeSeeds();
      for (const { record } of seeds) {
        const changed =
          record.slug === seeds[0].record.slug
            ? { ...record, label: 'Must not be written' }
            : record.slug === seeds.at(-1).record.slug
              ? {
                  ...record,
                  config: JSON.parse('{"__proto__":{}}'),
                }
              : record;
        await fs.writeFile(
          path.join(dir, `${record.slug}.json`),
          JSON.stringify(changed),
        );
      }
      await assert.rejects(initializeThemeSeeds(root), /config\.__proto__/);
      assert.deepEqual(
        await db
          .selectFrom('themes')
          .select(['slug', 'label', 'seed_hash'])
          .where('organization_id', 'is', null)
          .orderBy('slug')
          .execute(),
        before,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
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

  it('refuses malformed colors at create and update gates without writes', async () => {
    const record = (await readThemeSeeds())[0].record;
    const created = await createTheme(scopeA, {
      ...record,
      slug: 'color-gate-check',
    });
    assert.equal(created.ok, true);
    for (const colors of [
      { ...record.colors, primary: false },
      { ...record.colors, constructor: '#123456' },
    ]) {
      const field = Object.hasOwn(colors, 'constructor')
        ? 'colors.constructor'
        : 'colors.primary';
      assert.deepEqual(
        (await createTheme(scopeA, { ...record, slug: 'bad-colors', colors }))
          .where,
        field,
      );
      assert.deepEqual(
        (await updateTheme(scopeA, created.theme.id, { colors })).where,
        field,
      );
    }
    const unchanged = await getThemeRecord(scopeA, created.theme.id);
    assert.deepEqual(unchanged.colors, record.colors);
    assert.equal(
      await db
        .selectFrom('themes')
        .select('id')
        .where('slug', '=', 'bad-colors')
        .executeTakeFirst(),
      undefined,
    );
  });

  it('refuses JSON prototype config keys on create and update without writes', async () => {
    const record = (await readThemeSeeds())[0].record;
    const created = await createTheme(scopeA, {
      ...record,
      slug: 'config-gate-check',
    });
    assert.equal(created.ok, true);
    const originalConfig = (await getThemeRecord(scopeA, created.theme.id))
      .config;
    for (const key of ['__proto__', 'constructor', 'toString']) {
      for (const value of [{}, { inserted: true }]) {
        const config = JSON.parse(`{"${key}":${JSON.stringify(value)}}`);
        const create = await createTheme(scopeA, {
          ...record,
          slug: 'bad-config',
          config,
        });
        const update = await updateTheme(scopeA, created.theme.id, { config });
        for (const result of [create, update]) {
          assert.equal(result.ok, false);
          assert.equal(result.where, `config.${key}`);
          assert.equal(result.fieldProblem.code, 'unknown_field');
        }
      }
    }
    assert.deepEqual(
      (await getThemeRecord(scopeA, created.theme.id)).config,
      originalConfig,
    );
    assert.equal(
      await db
        .selectFrom('themes')
        .select('id')
        .where('slug', '=', 'bad-config')
        .executeTakeFirst(),
      undefined,
    );
  });
});
