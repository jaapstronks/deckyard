/**
 * Tests for the legacy-background migration script
 * (scripts/migrate-legacy-bg-image.js).
 *
 * The fold itself (`ensureSlideBgImage`) is pinned in
 * tests/legacy-bg-image.test.js. What is proven here is the migration around
 * it, which is where B175 found the two holes:
 *
 * 1. The walk reaches **every shape a slide is stored in** — a deck's
 *    `slides`, an `i18n.versions[lang].slides` entry (the surface that held
 *    *more* legacy pairs than the decks themselves in production), a library
 *    item's `content`, and a version snapshot's nested deck.
 * 2. The walk is **pure and idempotent** — a dry run cannot half-write, a
 *    second pass finds nothing, and files without the pair are left byte for
 *    byte alone.
 *
 * The Postgres route walks the same parsed JSON through the same function; what
 * is backend-specific (the SQL, the target list, `--include-versions`) is
 * covered against a real database in tests/pg/legacy-bg-image-migration.pgtest.js.
 *
 * Run with: node --test tests/legacy-bg-image-migration.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  foldLegacyBgImageDeep,
  migrateFileStore,
} from '../scripts/migrate-legacy-bg-image.js';

describe('foldLegacyBgImageDeep', () => {
  it('folds a legacy pair into the canonical key, with the .has-bg look', () => {
    const content = {
      title: 'Hallo',
      bgImage: '/uploads/bg.jpg',
      bgAlt: 'Een achtergrond',
    };
    const { value, count } = foldLegacyBgImageDeep(content);
    assert.equal(count, 1);
    assert.deepEqual(value, {
      title: 'Hallo',
      slideBgImage: '/uploads/bg.jpg',
      slideBgText: 'light',
      slideBgOverlay: 'gradient-bottom',
    });
    // Non-mutating: the input still carries the legacy pair.
    assert.equal(content.bgImage, '/uploads/bg.jpg');
  });

  it('reaches slide content nested in i18n language versions', () => {
    const deck = {
      id: 'd1',
      slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hallo' } }],
      i18n: {
        dominant: 'nl',
        versions: {
          'en-GB': {
            slides: [
              {
                id: 's1',
                type: 'title-slide',
                content: { title: 'Hello', bgImage: '/uploads/en.jpg' },
              },
            ],
          },
        },
      },
    };
    const { value, count } = foldLegacyBgImageDeep(deck);
    assert.equal(count, 1, 'the only legacy pair sits in a language version');
    const translated = value.i18n.versions['en-GB'].slides[0].content;
    assert.equal(translated.slideBgImage, '/uploads/en.jpg');
    assert.ok(!('bgImage' in translated));
    // The untouched Dutch slide is carried over unchanged.
    assert.deepEqual(value.slides[0].content, { title: 'Hallo' });
  });

  it('counts every folded slide across deck and versions', () => {
    const slide = (bg) => ({ id: 's', content: { bgImage: bg } });
    const { count } = foldLegacyBgImageDeep({
      slides: [slide('/a.jpg'), slide('/b.jpg')],
      i18n: { versions: { 'en-GB': { slides: [slide('/c.jpg')] } } },
    });
    assert.equal(count, 3);
  });

  it('is idempotent — a second pass finds nothing', () => {
    const once = foldLegacyBgImageDeep({ bgImage: '/a.jpg' });
    const twice = foldLegacyBgImageDeep(once.value);
    assert.equal(twice.count, 0);
    assert.equal(
      twice.value,
      once.value,
      'unchanged input is returned by identity',
    );
  });

  it('leaves content without the legacy pair alone, by identity', () => {
    const input = {
      slides: [
        { content: { title: 'x', slideBgImage: '/canon.jpg' } },
        { content: { title: 'y' } },
      ],
      // A value that merely mentions the name is not a legacy key.
      description: 'the old bgImage field is gone',
    };
    const { value, count } = foldLegacyBgImageDeep(input);
    assert.equal(count, 0);
    assert.equal(value, input);
  });

  it('keeps a deliberately cleared background cleared', () => {
    // Key presence is the "never chosen" / "deliberately cleared" distinction
    // that types with an autoBackgroundPreset read — see ensureSlideBgImage.
    const { value, count } = foldLegacyBgImageDeep({ bgImage: '' });
    assert.equal(count, 1);
    assert.deepEqual(value, { slideBgImage: '' });
  });

  it('drops the legacy image when a canonical one already won', () => {
    const { value, count } = foldLegacyBgImageDeep({
      slideBgImage: '/canon.jpg',
      bgImage: '/legacy.jpg',
      bgAlt: 'oud',
    });
    assert.equal(count, 1);
    assert.deepEqual(value, { slideBgImage: '/canon.jpg' });
  });
});

describe('migrateFileStore', () => {
  const LEGACY_SLIDE = (id, bg) => ({
    id,
    type: 'title-slide',
    content: { title: id, bgImage: bg, bgAlt: 'alt' },
  });

  /** Build a throwaway data dir with a deck, a version snapshot and a library item. */
  async function seed() {
    const root = await mkdtemp(path.join(tmpdir(), 'deckyard-bg-image-'));
    await mkdir(path.join(root, 'presentations'), { recursive: true });
    await mkdir(path.join(root, 'presentation-versions', 'd1'), {
      recursive: true,
    });
    await mkdir(path.join(root, 'slide-library', 'personal'), {
      recursive: true,
    });

    const deck = {
      id: 'd1',
      title: 'Testdeck',
      slides: [
        { id: 's1', type: 'title-slide', content: { title: 'Schoon' } },
        LEGACY_SLIDE('s2', '/uploads/nl.jpg'),
      ],
      i18n: {
        dominant: 'nl',
        versions: {
          'en-GB': { slides: [LEGACY_SLIDE('s2', '/uploads/en.jpg')] },
        },
      },
    };
    await writeFile(
      path.join(root, 'presentations', 'd1.json'),
      JSON.stringify(deck, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(root, 'presentation-versions', 'd1', 'v1.json'),
      JSON.stringify(
        { id: 'v1', presentationId: 'd1', presentation: deck },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(
      path.join(root, 'slide-library', 'personal', 'abc.json'),
      JSON.stringify(
        {
          v: 1,
          items: [
            {
              id: 'i1',
              name: 'Intro',
              slideType: 'title-slide',
              content: { title: 'Intro', bgImage: '/uploads/lib.jpg' },
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    // A deck without the legacy pair must not be rewritten at all.
    await writeFile(
      path.join(root, 'presentations', 'd2.json'),
      JSON.stringify(
        {
          id: 'd2',
          slides: [{ id: 's1', content: { slideBgImage: '/canon.jpg' } }],
        },
        null,
        2,
      ),
      'utf8',
    );
    return root;
  }

  const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

  it('--dry-run reports the hits and writes nothing', async () => {
    const root = await seed();
    const deckPath = path.join(root, 'presentations', 'd1.json');
    const before = await readFile(deckPath, 'utf8');

    const stats = await migrateFileStore(root, { dryRun: true });
    assert.equal(stats.filesModified, 2, 'deck + library item');
    assert.equal(
      stats.slidesMigrated,
      3,
      '1 deck slide, 1 language version, 1 library item',
    );
    assert.equal(
      await readFile(deckPath, 'utf8'),
      before,
      'dry run must not write',
    );
  });

  it('the real run folds the deck and its language versions', async () => {
    const root = await seed();
    const stats = await migrateFileStore(root);
    assert.equal(stats.filesModified, 2);
    assert.equal(stats.slidesMigrated, 3);

    const deck = await readJson(path.join(root, 'presentations', 'd1.json'));
    assert.deepEqual(deck.slides[1].content, {
      title: 's2',
      slideBgImage: '/uploads/nl.jpg',
      slideBgText: 'light',
      slideBgOverlay: 'gradient-bottom',
    });
    assert.deepEqual(deck.slides[0].content, { title: 'Schoon' });
    const translated = deck.i18n.versions['en-GB'].slides[0].content;
    assert.equal(translated.slideBgImage, '/uploads/en.jpg');
    assert.ok(!('bgAlt' in translated));

    const library = await readJson(
      path.join(root, 'slide-library', 'personal', 'abc.json'),
    );
    assert.equal(library.items[0].content.slideBgImage, '/uploads/lib.jpg');
  });

  it('skips version snapshots unless --include-versions is given', async () => {
    const root = await seed();
    const snapshotPath = path.join(
      root,
      'presentation-versions',
      'd1',
      'v1.json',
    );
    const before = await readFile(snapshotPath, 'utf8');

    await migrateFileStore(root);
    assert.equal(
      await readFile(snapshotPath, 'utf8'),
      before,
      'history is left as it was — the fold is lossy (see the script header)',
    );

    const stats = await migrateFileStore(root, { includeVersions: true });
    assert.equal(stats.filesModified, 1, 'only the snapshot is left to fold');
    assert.equal(stats.slidesMigrated, 2, 'its deck slide and its translation');
    const snapshot = await readJson(snapshotPath);
    assert.equal(
      snapshot.presentation.slides[1].content.slideBgImage,
      '/uploads/nl.jpg',
    );
  });

  it('a second run is a no-op', async () => {
    const root = await seed();
    await migrateFileStore(root, { includeVersions: true });
    const again = await migrateFileStore(root, { includeVersions: true });
    assert.equal(again.filesModified, 0);
    assert.equal(again.slidesMigrated, 0);
  });

  it('leaves files without the legacy pair byte-identical', async () => {
    const root = await seed();
    const untouched = path.join(root, 'presentations', 'd2.json');
    const before = await readFile(untouched, 'utf8');
    await migrateFileStore(root);
    assert.equal(await readFile(untouched, 'utf8'), before);
  });
});
