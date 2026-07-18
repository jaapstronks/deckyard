/**
 * App-settings theme wiring: the workspace default theme (defaultThemeId) and
 * the picker allowlist (enabledThemes) round-trip through read/write, normalize
 * safely, and getDefaultThemeId honors the setting > DEFAULT_THEME env > built-in
 * precedence (the fork seam).
 *
 * Run with: node --test tests/app-settings-default-theme.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-theme-settings-'));
process.env.DATA_DIR = tmp;

const {
  defaultAppSettings,
  readAppSettings,
  writeAppSettings,
  getDefaultThemeId,
} = await import('../server/storage/settings.js');
const { DEFAULT_THEME_ID } = await import('../shared/constants/themes.js');

const repoRoot = tmp;

describe('app settings: default theme + picker allowlist', () => {
  it('defaults expose defaultThemeId and enabledThemes', () => {
    const d = defaultAppSettings();
    assert.strictEqual(d.defaultThemeId, '');
    assert.deepStrictEqual(d.enabledThemes, []);
  });

  it('round-trips defaultThemeId and enabledThemes', async () => {
    await writeAppSettings(repoRoot, {
      defaultThemeId: 'clicknl',
      enabledThemes: ['deckyard', 'clicknl'],
    });
    const s = await readAppSettings(repoRoot);
    assert.strictEqual(s.defaultThemeId, 'clicknl');
    assert.deepStrictEqual(s.enabledThemes, ['deckyard', 'clicknl']);
  });

  it('rejects an invalid defaultThemeId (stored as empty)', async () => {
    await writeAppSettings(repoRoot, { defaultThemeId: 'bad id!!' });
    const s = await readAppSettings(repoRoot);
    assert.strictEqual(s.defaultThemeId, '');
  });

  it('a partial write does not clobber the other theme key', async () => {
    await writeAppSettings(repoRoot, {
      defaultThemeId: 'deckyard',
      enabledThemes: ['deckyard'],
    });
    // Write only the allowlist; defaultThemeId must survive.
    await writeAppSettings(repoRoot, { enabledThemes: ['deckyard', 'clicknl'] });
    const s = await readAppSettings(repoRoot);
    assert.strictEqual(s.defaultThemeId, 'deckyard');
    assert.deepStrictEqual(s.enabledThemes, ['deckyard', 'clicknl']);
  });
});

describe('getDefaultThemeId precedence', () => {
  it('uses the configured setting when present', async () => {
    await writeAppSettings(repoRoot, { defaultThemeId: 'clicknl' });
    delete process.env.DEFAULT_THEME;
    assert.strictEqual(await getDefaultThemeId(repoRoot), 'clicknl');
  });

  it('falls back to the DEFAULT_THEME env var (fork seam)', async () => {
    await writeAppSettings(repoRoot, { defaultThemeId: '' });
    process.env.DEFAULT_THEME = 'ciiic';
    try {
      assert.strictEqual(await getDefaultThemeId(repoRoot), 'ciiic');
    } finally {
      delete process.env.DEFAULT_THEME;
    }
  });

  it('falls back to the built-in default when nothing is set', async () => {
    await writeAppSettings(repoRoot, { defaultThemeId: '' });
    delete process.env.DEFAULT_THEME;
    assert.strictEqual(await getDefaultThemeId(repoRoot), DEFAULT_THEME_ID);
  });
});
