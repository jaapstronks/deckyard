/**
 * Organization theme fallback precedence when no theme settings are stored:
 * DEFAULT_THEME and ENABLED_THEMES resolve seed slugs, and only slugs, to UUIDs.
 *
 * Persistence cases — round-tripping defaultThemeId/enabledThemes, refusing
 * invalid IDs, partial-write no-clobber, and the configured-setting branch — live in
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

const { getDefaultThemeId, getEnabledThemeIds } =
  await import('../server/storage/settings.js');
const ORG = '33333333-3333-4333-8333-333333333333';
const scope = { organizationId: ORG };
const { DEFAULT_THEME_SLUG } = await import('../shared/constants/themes.js');
const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const CIIIC_ID = '22222222-2222-4222-8222-222222222222';

before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, settings: {} }],
      themes: [
        {
          id: BRAND_ID,
          organization_id: null,
          slug: DEFAULT_THEME_SLUG,
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

  // D237: the env names a seed by slug, and only by slug. A record UUID is a
  // second spelling for the same setting (and differs per installation); a
  // slug that names no seed must not quietly become another theme.
  for (const value of [CIIIC_ID, 'no-such-seed', 'CIIIC']) {
    it(`refuses DEFAULT_THEME=${value}`, async () => {
      process.env.DEFAULT_THEME = value;
      try {
        await assert.rejects(getDefaultThemeId(scope), {
          message: `Default theme seed not found: ${value}`,
        });
      } finally {
        delete process.env.DEFAULT_THEME;
      }
    });
  }
});

describe('getEnabledThemeIds fallback precedence (empty store)', () => {
  it('falls back to the ENABLED_THEMES env var (fork seam)', async () => {
    process.env.ENABLED_THEMES = 'ciiic, unknown ,,brand';
    try {
      assert.deepStrictEqual(await getEnabledThemeIds(scope), [
        CIIIC_ID,
        BRAND_ID,
      ]);
    } finally {
      delete process.env.ENABLED_THEMES;
    }
  });

  it('drops ids that are not theme ids at all', async () => {
    process.env.ENABLED_THEMES = 'brand,../../etc/passwd,ok-2';
    try {
      assert.deepStrictEqual(await getEnabledThemeIds(scope), [BRAND_ID]);
    } finally {
      delete process.env.ENABLED_THEMES;
    }
  });

  it('reads seed slugs only, not record UUIDs', async () => {
    process.env.ENABLED_THEMES = `${CIIIC_ID},brand`;
    try {
      assert.deepStrictEqual(await getEnabledThemeIds(scope), [BRAND_ID]);
    } finally {
      delete process.env.ENABLED_THEMES;
    }
  });

  it('is empty when nothing is set — no allowlist, so every theme is offered', async () => {
    delete process.env.ENABLED_THEMES;
    assert.deepStrictEqual(await getEnabledThemeIds(scope), []);
  });
});
