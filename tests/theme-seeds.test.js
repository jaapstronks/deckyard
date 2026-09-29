import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readCoreThemeSeeds,
  readThemeSeeds,
  validateThemeSeed,
} from '../server/utils/theme-seeds.js';
import { createTheme } from '../server/storage/themes.js';
import { testScope } from './helpers/storage-scope.js';

test('six core records pass the strict seed gate', async () => {
  const seeds = await readCoreThemeSeeds();
  assert.equal(seeds.length, 6);
  assert.equal(new Set(seeds.map(({ record }) => record.slug)).size, 6);
});

test('unknown fields, family ids and non-curated fonts fail by path', async () => {
  const [{ record }] = await readCoreThemeSeeds();
  for (const [change, field] of [
    [{ extra: true }, 'extra'],
    [
      { fonts: { ...record.fonts, headingFamilyId: 'x' } },
      'fonts.headingFamilyId',
    ],
    [{ fonts: { ...record.fonts, heading: 'Missing Font' } }, 'fonts.heading'],
    [{ config: { titleLayout: 'sideways' } }, 'config.titleLayout'],
    [{ config: { logos: [] } }, 'config.logos'],
    [
      { config: { slideTypes: { include: 'bad-shape' } } },
      'config.slideTypes.include',
    ],
  ]) {
    assert.throws(
      () => validateThemeSeed({ ...record, ...change }, `${record.slug}.json`),
      new RegExp(field),
    );
  }
});

test('seed and API create gates refuse JSON prototype config keys', async () => {
  const [{ record }] = await readCoreThemeSeeds();
  for (const key of ['__proto__', 'constructor', 'toString']) {
    for (const value of [{}, { inserted: true }]) {
      const config = JSON.parse(`{"${key}":${JSON.stringify(value)}}`);
      assert.throws(
        () => validateThemeSeed({ ...record, config }, `${record.slug}.json`),
        (error) => error.message.includes(`config.${key}`),
      );
      const result = await createTheme(testScope(), {
        ...record,
        slug: 'bad-config',
        config,
      });
      assert.equal(result.ok, false);
      assert.equal(result.where, `config.${key}`);
      assert.equal(result.fieldProblem.code, 'unknown_field');
    }
  }
});

test('seed gate refuses invalid base colors and prototype field names', async () => {
  const [{ record }] = await readCoreThemeSeeds();
  for (const role of ['primary', 'background', 'textLight', 'textDark']) {
    for (const value of [false, 0, null, '']) {
      assert.throws(
        () =>
          validateThemeSeed(
            { ...record, colors: { ...record.colors, [role]: value } },
            `${record.slug}.json`,
          ),
        new RegExp(`colors\\.${role}`),
      );
    }
  }
  for (const key of ['constructor', 'toString', '__proto__']) {
    assert.throws(
      () =>
        validateThemeSeed(
          { ...record, colors: { ...record.colors, [key]: '#123456' } },
          `${record.slug}.json`,
        ),
      new RegExp(`colors\\.${key}`),
    );
  }
});

test('the API create gate refuses invalid colors before opening storage', async () => {
  for (const [colors, where] of [
    [{ primary: false }, 'colors.primary'],
    [{ background: 0 }, 'colors.background'],
    [{ textLight: null }, 'colors.textLight'],
    [{ textDark: '' }, 'colors.textDark'],
    [{ constructor: '#123456' }, 'colors.constructor'],
    [{ toString: '#123456' }, 'colors.toString'],
  ]) {
    const result = await createTheme(testScope(), {
      label: 'Invalid colors',
      colors,
    });
    assert.equal(result.ok, false);
    assert.equal(result.where, where);
  }
});

test('fork seeds load from DECKYARD_CUSTOM_DIR and invalid seeds refuse the batch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-seeds-'));
  const fork = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-fork-seeds-'));
  try {
    await fs.mkdir(path.join(root, 'themes'), { recursive: true });
    await fs.mkdir(path.join(fork, 'themes'), { recursive: true });
    const seeds = await readCoreThemeSeeds();
    for (const { record } of seeds)
      await fs.writeFile(
        path.join(root, 'themes', `${record.slug}.json`),
        JSON.stringify(record),
      );
    const { record } = seeds[0];
    const forkFile = path.join(fork, 'themes', 'fork-theme.json');
    await fs.writeFile(
      forkFile,
      JSON.stringify({ ...record, slug: 'fork-theme' }),
    );
    const script = `import { readThemeSeeds } from './server/utils/theme-seeds.js';\nreadThemeSeeds(process.argv[1]).then(s => console.log(s.length)).catch(e => { console.error(e.message); process.exitCode = 1; });`;
    const { spawnSync } = await import('node:child_process');
    const run = () =>
      spawnSync(process.execPath, ['--input-type=module', '-e', script, root], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, DECKYARD_CUSTOM_DIR: fork },
        encoding: 'utf8',
      });
    assert.equal(run().stdout.trim(), '7');
    await fs.writeFile(
      forkFile,
      JSON.stringify({
        ...record,
        slug: 'fork-theme',
        config: { titleLayout: 'sideways' },
      }),
    );
    assert.match(run().stderr, /config.titleLayout/);
    await fs.rm(forkFile);
    await fs.writeFile(
      path.join(fork, 'themes', `${record.slug}.json`),
      JSON.stringify(record),
    );
    assert.match(run().stderr, /themes.*themes\/amethyst.json/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(fork, { recursive: true, force: true });
  }
});

test('duplicate core and fork slug fails before database writes and names both files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-seeds-'));
  try {
    await fs.mkdir(path.join(root, 'themes'), { recursive: true });
    await fs.mkdir(path.join(root, 'custom', 'themes'), { recursive: true });
    const seeds = await readCoreThemeSeeds();
    for (const { record } of seeds)
      await fs.writeFile(
        path.join(root, 'themes', `${record.slug}.json`),
        JSON.stringify(record),
      );
    const { record } = seeds[0];
    await fs.writeFile(
      path.join(root, 'custom/themes', `${record.slug}.json`),
      JSON.stringify(record),
    );
    await assert.rejects(readThemeSeeds(root), /themes.*custom\/themes/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
