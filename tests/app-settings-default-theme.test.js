/**
 * App-settings theme wiring, the parts that need no persistence: the default
 * shape, and getDefaultThemeId's fallback precedence when nothing is stored
 * (DEFAULT_THEME env > built-in — the fork seam). With no database configured
 * the settings store reads back empty, which is exactly the "nothing set" state
 * these fallbacks describe.
 *
 * The persistence cases — round-tripping defaultThemeId/enabledThemes, invalid-
 * id normalization, partial-write no-clobber, and the configured-setting branch
 * of getDefaultThemeId — persist in PostgreSQL and live in
 * tests/pg/settings.pgtest.js.
 *
 * Run with: node --test tests/app-settings-default-theme.test.js
 */

import { before, after, describe, it } from 'node:test';
import assert from 'node:assert';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import {
  initializeStorage,
  __resetStorageForTests,
} from '../server/storage/lifecycle.js';

const { defaultAppSettings, getDefaultThemeId, getEnabledThemeIds } =
  await import('../server/storage/settings.js');
const { crossOrganizationScope } = await import('../server/storage/scope.js');
const scope = crossOrganizationScope(
  null,
  'test: instance-level settings read',
);
const { DEFAULT_THEME_ID } = await import('../shared/constants/themes.js');
const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const CIIIC_ID = '22222222-2222-4222-8222-222222222222';

before(async () => {
  __setTestDb(
    createFakeDb({
      themes: [
        {
          id: BRAND_ID,
          organization_id: null,
          slug: DEFAULT_THEME_ID,
          label: 'Brand',
          colors: {},
          fonts: {},
          config: {},
        },
        {
          id: CIIIC_ID,
          organization_id: null,
          slug: 'ciiic',
          label: 'CIIIC',
          colors: {},
          fonts: {},
          config: {},
        },
      ],
    }),
  );
  await initializeStorage();
});
after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

describe('app settings: default theme + picker allowlist', () => {
  it('defaults expose defaultThemeId and enabledThemes', () => {
    const d = defaultAppSettings();
    assert.strictEqual(d.defaultThemeId, '');
    assert.deepStrictEqual(d.enabledThemes, []);
  });
});

describe('getDefaultThemeId fallback precedence (empty store)', () => {
  it('falls back to the DEFAULT_THEME env var (fork seam)', async () => {
    process.env.DEFAULT_THEME = 'ciiic';
    try {
      assert.strictEqual(await getDefaultThemeId(scope), CIIIC_ID);
    } finally {
      delete process.env.DEFAULT_THEME;
    }
  });

  it('falls back to the built-in default when nothing is set', async () => {
    delete process.env.DEFAULT_THEME;
    assert.strictEqual(await getDefaultThemeId(scope), BRAND_ID);
  });
});

describe('getEnabledThemeIds fallback precedence (empty store)', () => {
  it('falls back to the ENABLED_THEMES env var (fork seam)', async () => {
    process.env.ENABLED_THEMES = 'ciiic, Editorial ,,brand';
    try {
      assert.deepStrictEqual(await getEnabledThemeIds(scope), [
        'ciiic',
        'editorial',
        'brand',
      ]);
    } finally {
      delete process.env.ENABLED_THEMES;
    }
  });

  it('drops ids that are not theme ids at all', async () => {
    process.env.ENABLED_THEMES = 'brand,../../etc/passwd,ok-2';
    try {
      assert.deepStrictEqual(await getEnabledThemeIds(scope), [
        'brand',
        'ok-2',
      ]);
    } finally {
      delete process.env.ENABLED_THEMES;
    }
  });

  it('is empty when nothing is set — no allowlist, so every theme is offered', async () => {
    delete process.env.ENABLED_THEMES;
    assert.deepStrictEqual(await getEnabledThemeIds(scope), []);
  });
});
