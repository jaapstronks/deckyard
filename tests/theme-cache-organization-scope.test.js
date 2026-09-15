/**
 * The custom-theme cache keeps the organization filter a session asked for.
 *
 * `loadThemeAssets` memoizes database themes per UUID for the whole process.
 * A deck render loads its theme unscoped (the deck authorized it), which warms
 * that cache. A session-scoped load of the same UUID used to take the cache
 * hit without looking at whose theme it was, so the organization filter the
 * database read applies only held on a cold cache.
 *
 * That mattered once `POST /api/render-slide` (B278) took a theme id from the
 * client instead of from a deck: a session in organization B could render with
 * organization A's theme by naming its UUID. A cache hit now has to belong to
 * the session's organization, exactly like the row the database would return.
 *
 * Run with: node --test tests/theme-cache-organization-scope.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope, otherOrganizationScope } from './helpers/storage-scope.js';
import { userRows } from './helpers/identity-fixtures.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createTheme } = await import('../server/storage/themes.js');
const { loadThemeAssets, clearCustomThemeCache } =
  await import('../server/utils/themes.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test('a warm cache does not hand another organization its theme', async () => {
  clearCustomThemeCache();
  const created = await createTheme(testScope(null, { actorEmail: OWNER }), {
    label: 'Acme',
    slug: 'acme',
    colors: { primary: '#ff0055' },
  });
  assert.equal(created.ok, true);
  const uuid = created.theme.id;

  // A deck render: unscoped, and it warms the cache.
  const viaDeck = await loadThemeAssets(repoRoot, uuid);
  assert.equal(viaDeck._customThemeId, uuid);

  const own = await loadThemeAssets(repoRoot, uuid, testScope());
  assert.equal(own._customThemeId, uuid, 'the owning organization gets it');

  const other = await loadThemeAssets(repoRoot, uuid, otherOrganizationScope());
  assert.notEqual(
    other?._customThemeId,
    uuid,
    'another organization gets the default theme, not this one',
  );
});
