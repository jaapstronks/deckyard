import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readThemeSeeds,
  validateThemeSeed,
} from '../server/utils/theme-seeds.js';

test('six core records pass the strict seed gate', async () => {
  const seeds = await readThemeSeeds();
  assert.equal(seeds.length, 6);
  assert.equal(new Set(seeds.map(({ record }) => record.slug)).size, 6);
});

test('unknown fields, family ids and non-curated fonts fail by path', async () => {
  const [{ record }] = await readThemeSeeds();
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

test('fork seeds load from DECKYARD_CUSTOM_DIR and invalid seeds refuse the batch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-seeds-'));
  const fork = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-fork-seeds-'));
  try {
    await fs.mkdir(path.join(root, 'themes', 'seeds'), { recursive: true });
    await fs.mkdir(path.join(fork, 'themes'), { recursive: true });
    const seeds = await readThemeSeeds();
    for (const { record } of seeds)
      await fs.writeFile(
        path.join(root, 'themes/seeds', `${record.slug}.json`),
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
    assert.match(run().stderr, /themes\/seeds.*themes\/amethyst.json/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(fork, { recursive: true, force: true });
  }
});

test('duplicate core and fork slug fails before database writes and names both files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-seeds-'));
  try {
    await fs.mkdir(path.join(root, 'themes', 'seeds'), { recursive: true });
    await fs.mkdir(path.join(root, 'custom', 'themes'), { recursive: true });
    const seeds = await readThemeSeeds();
    for (const { record } of seeds)
      await fs.writeFile(
        path.join(root, 'themes/seeds', `${record.slug}.json`),
        JSON.stringify(record),
      );
    const { record } = seeds[0];
    await fs.writeFile(
      path.join(root, 'custom/themes', `${record.slug}.json`),
      JSON.stringify(record),
    );
    await assert.rejects(readThemeSeeds(root), /themes\/seeds.*custom\/themes/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
