import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDb } from './helpers/fake-db.js';
import {
  parseArgs,
  planThemeReferenceMigration,
  validateMapping,
} from '../scripts/migrate-theme-references.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const SEED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const A_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const B_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function fixture(overrides = {}) {
  return createFakeDb({
    organizations: [{ id: ORG_A }, { id: ORG_B }],
    themes: [
      { id: SEED_ID, slug: 'aurora', organization_id: null },
      { id: A_ID, slug: 'brand', organization_id: ORG_A },
      { id: B_ID, slug: 'brand', organization_id: ORG_B },
    ],
    presentations: [
      { id: 'deck-a', organization_id: ORG_A, theme: 'brand' },
      { id: 'deck-b', organization_id: ORG_B, theme: 'aurora' },
      { id: 'deck-default', organization_id: ORG_A, theme: 'default' },
    ],
    slide_library: [{ id: 'lib-a', organization_id: ORG_A, theme_id: 'brand' }],
    presentation_versions: [
      {
        id: 'version-a',
        presentation_id: 'deck-a',
        presentation_data: { title: 'Saved', theme: 'brand' },
      },
    ],
    app_settings: [
      {
        id: true,
        settings: {
          defaultThemeId: 'brand',
          enabledThemes: ['brand', 'aurora'],
        },
      },
    ],
    ...overrides,
  });
}

test('plans all four surfaces with per-org mapping and seed IDs without mutating rows', async () => {
  const db = fixture();
  const report = await planThemeReferenceMigration(
    db,
    { [ORG_A]: { brand: A_ID } },
    ORG_A,
  );
  assert.equal(report.ok, true);
  assert.deepEqual(report.counts, {
    presentations: 2,
    slide_library: 1,
    app_settings: 1,
    organizations: 1,
    presentation_versions: 1,
  });
  const byTable = Object.fromEntries(
    report.updates.map((update) => [
      update.table + '/' + update.id,
      update.values,
    ]),
  );
  assert.equal(byTable['presentations/deck-a'].theme, A_ID);
  assert.equal(byTable['presentations/deck-b'].theme, SEED_ID);
  assert.equal(byTable['slide_library/lib-a'].theme_id, A_ID);
  assert.equal(
    JSON.parse(byTable['presentation_versions/version-a'].presentation_data)
      .theme,
    A_ID,
  );
  assert.deepEqual(
    JSON.parse(byTable[`organizations/${ORG_A}`].settings).enabledThemes,
    [A_ID, SEED_ID],
  );
  assert.equal(
    (
      await db
        .selectFrom('presentations')
        .select('theme')
        .where('id', '=', 'deck-a')
        .executeTakeFirst()
    ).theme,
    'brand',
  );
});

test('reports unknown and cross-org references with their table and row IDs', async () => {
  const db = fixture({
    presentations: [
      { id: 'bad-deck', organization_id: ORG_A, theme: 'missing' },
    ],
    slide_library: [
      { id: 'bad-library', organization_id: ORG_A, theme_id: B_ID },
    ],
    presentation_versions: [
      {
        id: 'bad-version',
        presentation_id: 'bad-deck',
        presentation_data: { theme: 'missing' },
      },
    ],
    app_settings: [{ id: true, settings: { enabledThemes: ['missing'] } }],
  });
  const report = await planThemeReferenceMigration(db, {}, ORG_A);
  assert.equal(report.ok, false);
  assert.match(
    report.errors.join('\n'),
    /presentations\/bad-deck\.theme: unknown theme slug/,
  );
  assert.match(
    report.errors.join('\n'),
    /slide_library\/bad-library\.theme_id: UUID .* outside the organization/,
  );
  assert.match(
    report.errors.join('\n'),
    /presentation_versions\/bad-version\.presentation_data\.theme/,
  );
  assert.match(
    report.errors.join('\n'),
    /app_settings\/true\.enabledThemes\[0\]/,
  );
});

test('an explicit map cannot resolve to another organization theme', async () => {
  const report = await planThemeReferenceMigration(
    fixture(),
    { [ORG_A]: { brand: B_ID } },
    ORG_A,
  );
  assert.equal(report.ok, false);
  assert.match(
    report.errors.join('\n'),
    /map\/11111111.*outside the organization/,
  );
});

test('already canonical references require no updates', async () => {
  const db = fixture({
    presentations: [{ id: 'deck-a', organization_id: ORG_A, theme: A_ID }],
    slide_library: [{ id: 'lib-a', organization_id: ORG_A, theme_id: SEED_ID }],
    presentation_versions: [
      {
        id: 'version-a',
        presentation_id: 'deck-a',
        presentation_data: { theme: A_ID },
      },
    ],
    app_settings: [{ id: true, settings: {} }],
    organizations: [
      { id: ORG_A, settings: { defaultThemeId: A_ID, enabledThemes: [] } },
      { id: ORG_B, settings: {} },
    ],
  });
  const report = await planThemeReferenceMigration(
    db,
    { [ORG_A]: { brand: A_ID } },
    ORG_A,
  );
  assert.equal(report.ok, true);
  assert.deepEqual(report.updates, []);
});

test('requires explicit operation, map, settings org, and valid mapping', () => {
  assert.throws(
    () => parseArgs(['--map', 'x', '--settings-org', ORG_A]),
    /Usage/,
  );
  assert.throws(
    () =>
      parseArgs(['--check', '--apply', '--map', 'x', '--settings-org', ORG_A]),
    /exactly one/,
  );
  assert.throws(
    () => validateMapping({ [ORG_A]: { brand: ORG_B, default: ORG_B } }),
    /Invalid mapping/,
  );
});
