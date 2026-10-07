/**
 * B352: the sandbox library seed is a valid declaration.
 *
 * The sandbox seeds the organization shelf from
 * `server/sandbox-examples/library/` (server/sandbox/library.js). The files are
 * committed, so a slide that names an unknown or library-less type, a theme no
 * core seed carries, or content its type refuses would be seeded into every
 * sandbox and break on screen. This holds each file to the same rules a save
 * to the library meets. The write itself is pinned against PostgreSQL in
 * tests/pg/sandbox-library-seed.pgtest.js.
 *
 * Run with: node --test tests/sandbox-library-seed.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { repoRoot } from '../server/config/paths.js';
import {
  readSandboxLibrarySeed,
  seedRowId,
  seedSandboxLibrary,
} from '../server/sandbox/library.js';
import { readCoreThemeSeeds } from '../server/utils/theme-seeds.js';
import { SLIDE_TYPES, validateSlide } from '../shared/slide-types.js';
import { isLibrarySlideType } from '../shared/slide-types/policy.js';

const seed = await readSandboxLibrarySeed(repoRoot);
const coreSlugs = new Set(
  (await readCoreThemeSeeds()).map(({ record }) => record.slug),
);

test('the seed holds a handful of slides and at least one collection', () => {
  assert.ok(seed.slides.length >= 4, 'a handful of slides');
  assert.ok(seed.collections.length >= 1, 'one collection');
});

test('every seeded slide is a library type with valid content', () => {
  for (const slide of seed.slides) {
    assert.ok(
      isLibrarySlideType(SLIDE_TYPES[slide.slideType]),
      `${slide.key}: ${slide.slideType} is a library type`,
    );
    assert.deepEqual(
      validateSlide({
        id: crypto.randomUUID(),
        type: slide.slideType,
        content: slide.content,
      }),
      [],
      `${slide.key}: content is valid`,
    );
  }
});

test('every seeded slide names a core theme seed by slug', () => {
  for (const slide of seed.slides)
    assert.ok(coreSlugs.has(slide.theme), `${slide.key}: ${slide.theme}`);
});

test('a seed key fixes one UUID, distinct per kind and key', () => {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const id = seedRowId('slide', 'headline-results');
  assert.match(id, uuid);
  assert.equal(seedRowId('slide', 'headline-results'), id);
  assert.notEqual(seedRowId('collection', 'headline-results'), id);
  const ids = seed.slides.map((s) => seedRowId('slide', s.key));
  assert.equal(new Set(ids).size, ids.length);
});

test('outside sandbox mode the seed writes nothing', async () => {
  const saved = process.env.SANDBOX_MODE;
  delete process.env.SANDBOX_MODE;
  try {
    // No database is installed here: reaching it would throw.
    assert.deepEqual(await seedSandboxLibrary(repoRoot), {
      slides: 0,
      collections: 0,
    });
  } finally {
    if (saved !== undefined) process.env.SANDBOX_MODE = saved;
  }
});
