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
  ]) {
    assert.throws(
      () => validateThemeSeed({ ...record, ...change }, `${record.slug}.json`),
      new RegExp(field),
    );
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
