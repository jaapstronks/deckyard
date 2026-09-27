import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import {
  initializeStorage,
  __resetStorageForTests,
} from '../server/storage/lifecycle.js';
import {
  loadThemeAssets,
  findTheme,
  clearCustomThemeCache,
} from '../server/utils/themes.js';

const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const ORG_B = '00000000-0000-0000-0000-0000000000bb';
const SEED_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const scope = (organizationId) => ({ organizationId, repoRoot: process.cwd() });
const row = (id, slug, organizationId, defaultBackground) => ({
  id,
  slug,
  organization_id: organizationId,
  label: slug,
  logo_url: null,
  logo_small_url: null,
  colors: {
    primary: '#337755',
    background: '#ffffff',
    textLight: '#ffffff',
    textDark: '#222222',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
  config: { version: 1, defaultBackground },
  is_default: false,
  created_at: '2026-09-27T00:00:00Z',
  updated_at: '2026-09-27T00:00:00Z',
  created_by: null,
});

test.before(async () => {
  process.env.DEFAULT_ORGANIZATION_ID = ORG_A;
  __setTestDb(
    createFakeDb({
      organizations: [
        {
          id: ORG_A,
          name: 'A',
          slug: 'a',
          settings: { defaultThemeId: ORG_ID },
        },
        { id: ORG_B, name: 'B', slug: 'b', settings: {} },
      ],
      themes: [
        row(SEED_ID, 'brand', null, 'lime'),
        row(ORG_ID, 'mist-org', ORG_A, 'mist'),
      ],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  clearCustomThemeCache();
  __resetStorageForTests();
  __setTestDb(null);
});

test('default composes against the authorized deck organization', async () => {
  const a = await loadThemeAssets(process.cwd(), 'default', scope(ORG_A));
  assert.equal(a.id, ORG_ID);
  assert.equal(a.defaultBackground, 'mist');
  const seed = await loadThemeAssets(process.cwd(), SEED_ID, scope(ORG_A));
  assert.equal(seed.id, SEED_ID, 'explicit selection stays on its record');
  assert.equal(seed.defaultBackground, 'lime');
  const b = await loadThemeAssets(process.cwd(), 'default', scope(ORG_B));
  assert.equal(b.id, SEED_ID, 'foreign configured default falls back to seed');
});

test('record cache keeps organization isolation and slugs are not runtime IDs', async () => {
  await loadThemeAssets(process.cwd(), ORG_ID, scope(ORG_A));
  await assert.rejects(
    loadThemeAssets(process.cwd(), ORG_ID, scope(ORG_B)),
    /Theme not found/,
  );
  assert.equal(await findTheme(process.cwd(), 'mist-org', scope(ORG_A)), null);
  await assert.rejects(
    loadThemeAssets(process.cwd(), 'mist-org', scope(ORG_A)),
    /Invalid theme ID/,
  );
});
