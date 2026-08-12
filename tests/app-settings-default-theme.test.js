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

import { describe, it } from 'node:test';
import assert from 'node:assert';

const { defaultAppSettings, getDefaultThemeId } = await import(
  '../server/storage/settings.js'
);
const { crossOrganizationScope } = await import('../server/storage/scope.js');
const scope = crossOrganizationScope(null, 'test: instance-level settings read');
const { DEFAULT_THEME_ID } = await import('../shared/constants/themes.js');

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
      assert.strictEqual(await getDefaultThemeId(scope), 'ciiic');
    } finally {
      delete process.env.DEFAULT_THEME;
    }
  });

  it('falls back to the built-in default when nothing is set', async () => {
    delete process.env.DEFAULT_THEME;
    assert.strictEqual(await getDefaultThemeId(scope), DEFAULT_THEME_ID);
  });
});
