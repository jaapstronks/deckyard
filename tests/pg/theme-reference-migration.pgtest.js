import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { initializeThemeSeeds } from '../../server/utils/theme-seeds.js';
import { migrateThemeReferences } from '../../scripts/migrate-theme-references.js';
import { createPresentation } from '../../server/storage/presentations/index.js';
import { loadThemeAssets } from '../../server/utils/themes.js';

pgDescribe('theme reference migration (real PostgreSQL)', () => {
  let db, org, brand, editorial, deck, library, version;
  before(async () => {
    db = await openTestDb();
  });
  after(async () => {
    await closeTestDb(db);
  });
  beforeEach(async () => {
    await truncate(db, 'organizations', 'themes', 'app_settings');
    org = await seedDefaultOrganization(db);
    await initializeThemeSeeds();
    const seeds = await db
      .selectFrom('themes')
      .select(['id', 'slug'])
      .where('organization_id', 'is', null)
      .execute();
    brand = seeds.find((row) => row.slug === 'brand').id;
    editorial = seeds.find((row) => row.slug === 'editorial').id;
    deck = randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id: deck,
        organization_id: org,
        title: 'Migration deck',
        theme: 'brand',
        slides: JSON.stringify([]),
      })
      .execute();
    const lib = await db
      .insertInto('slide_library')
      .values({
        organization_id: org,
        shelf: 'organization',
        name: 'Slide',
        slide_type: 'title-slide',
        content: JSON.stringify({ title: 'Slide' }),
        theme_id: 'editorial',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    library = lib.id;
    const snap = await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: deck,
        organization_id: org,
        title: 'Snapshot',
        presentation_data: JSON.stringify({ title: 'Saved', theme: 'brand' }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    version = snap.id;
    await db
      .insertInto('app_settings')
      .values({
        id: true,
        settings: JSON.stringify({
          defaultThemeId: 'brand',
          enabledThemes: ['brand', 'editorial'],
          sessionDurationDays: 30,
        }),
      })
      .execute();
  });

  async function read() {
    const [p, l, v, a, o] = await Promise.all([
      db
        .selectFrom('presentations')
        .select('theme')
        .where('id', '=', deck)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('slide_library')
        .select('theme_id')
        .where('id', '=', library)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('presentation_versions')
        .select('presentation_data')
        .where('id', '=', version)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('app_settings')
        .select('settings')
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('organizations')
        .select('settings')
        .where('id', '=', org)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      presentation: p.theme,
      library: l.theme_id,
      snapshot: v.presentation_data.theme,
      app: a.settings,
      organization: o.settings,
    };
  }

  it('checks without writes, applies all four surfaces atomically, then has no work', async () => {
    const before = await read();
    const checked = await migrateThemeReferences(db, {}, org);
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.counts, {
      presentations: 1,
      slide_library: 1,
      app_settings: 1,
      organizations: 1,
      presentation_versions: 1,
    });
    assert.deepEqual(await read(), before);
    const applied = await migrateThemeReferences(db, {}, org, { apply: true });
    assert.equal(applied.ok, true);
    const after = await read();
    assert.equal(after.presentation, brand);
    assert.equal(after.library, editorial);
    assert.equal(after.snapshot, brand);
    assert.equal(after.organization.defaultThemeId, brand);
    assert.deepEqual(after.organization.enabledThemes, [brand, editorial]);
    assert.equal(after.app.defaultThemeId, undefined);
    assert.equal(after.app.enabledThemes, undefined);
    assert.equal(after.app.sessionDurationDays, 30);
    assert.deepEqual(
      (await migrateThemeReferences(db, {}, org, { apply: true })).updates,
      [],
    );
  });

  it('refuses an unknown slug without changing any row', async () => {
    await db
      .updateTable('slide_library')
      .set({ theme_id: 'unknown' })
      .where('id', '=', library)
      .execute();
    const before = await read();
    const result = await migrateThemeReferences(db, {}, org, { apply: true });
    assert.equal(result.ok, false);
    assert.match(
      result.errors.join('\n'),
      /slide_library\/.*unknown theme slug/,
    );
    assert.deepEqual(await read(), before);
  });

  it('creates and renders a sandbox deck from an overridden seed handle', async () => {
    process.env.SANDBOX_MODE = '1';
    process.env.SANDBOX_DEFAULT_THEME = 'editorial';
    try {
      const scope = { organizationId: org, repoRoot: process.cwd() };
      const created = await createPresentation(scope, { title: 'Sandbox' });
      assert.equal(created.theme, editorial);
      const stored = await db
        .selectFrom('presentations')
        .select('theme')
        .where('id', '=', created.id)
        .executeTakeFirstOrThrow();
      assert.equal(stored.theme, editorial);
      assert.equal(
        (await loadThemeAssets(process.cwd(), stored.theme, scope)).id,
        editorial,
      );
    } finally {
      delete process.env.SANDBOX_MODE;
      delete process.env.SANDBOX_DEFAULT_THEME;
    }
  });
});
