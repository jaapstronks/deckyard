/**
 * Tests for the `lijstje-slide` → `list-slide` rename migration
 * (scripts/migrate-lijstje-slide.js).
 *
 * Two things need proving, and they are different claims:
 *
 * 1. The rewrite is **lossless and idempotent** — only `type`/`slideType` move,
 *    `content` survives byte for byte, and a second pass finds nothing.
 * 2. It reaches **every shape a slide is stored in**: a deck's `slides`, an
 *    `i18n.versions[lang].slides` entry, a version snapshot's nested
 *    `presentation`, and a slide-library item's `slideType`. The Postgres route
 *    walks the same parsed JSON through the same function, so covering the
 *    shapes here covers both backends; what is backend-specific (the SQL) is
 *    verified by hand against a real database — see the brief.
 *
 * Run with: node --test tests/lijstje-slide-migration.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  OLD_TYPE,
  NEW_TYPE,
  renameSlideTypeDeep,
  migrateFileStore,
} from '../scripts/migrate-lijstje-slide.js';

describe('renameSlideTypeDeep', () => {
  it('rewrites the type and leaves content untouched', () => {
    const slide = {
      id: 's1',
      type: OLD_TYPE,
      content: {
        title: 'Lijstje',
        items: [{ text: 'een' }, { text: 'twee' }],
        variant: 'numbers',
      },
      notes: 'blijft staan',
    };
    const { value, count } = renameSlideTypeDeep(slide);
    assert.equal(count, 1);
    assert.equal(value.type, NEW_TYPE);
    assert.deepEqual(value.content, slide.content);
    assert.equal(value.notes, 'blijft staan');
    // Non-mutating: the input is still the old shape.
    assert.equal(slide.type, OLD_TYPE);
  });

  it('is idempotent — a second pass finds nothing', () => {
    const once = renameSlideTypeDeep({ type: OLD_TYPE, content: {} });
    const twice = renameSlideTypeDeep(once.value);
    assert.equal(twice.count, 0);
    assert.equal(
      twice.value,
      once.value,
      'unchanged input is returned by identity',
    );
  });

  it('reaches slides nested in i18n versions and version snapshots', () => {
    const deck = {
      id: 'd1',
      slides: [{ id: 's1', type: OLD_TYPE, content: {} }],
      i18n: {
        dominant: 'nl',
        versions: {
          'en-GB': {
            slides: [{ id: 's1', type: OLD_TYPE, content: { title: 'List' } }],
          },
        },
      },
    };
    const snapshot = { id: 'v1', presentation: deck };
    const { value, count } = renameSlideTypeDeep(snapshot);
    assert.equal(count, 2);
    assert.equal(value.presentation.slides[0].type, NEW_TYPE);
    assert.equal(
      value.presentation.i18n.versions['en-GB'].slides[0].type,
      NEW_TYPE,
    );
  });

  it('rewrites slideType, the key the slide library stores', () => {
    const item = {
      id: 'i1',
      name: 'Mijn lijstje',
      slideType: OLD_TYPE,
      content: { title: 'x' },
    };
    const { value, count } = renameSlideTypeDeep(item);
    assert.equal(count, 1);
    assert.equal(value.slideType, NEW_TYPE);
  });

  it('leaves other types and lookalike values alone', () => {
    const input = {
      slides: [
        { type: 'list-slide', content: {} },
        { type: 'title-slide', content: {} },
      ],
      // A value that merely mentions the name is not a type declaration.
      description: `superseded by ${OLD_TYPE}`,
      cssClass: 'slide-lijstje',
    };
    const { value, count } = renameSlideTypeDeep(input);
    assert.equal(count, 0);
    assert.equal(value, input);
  });
});

describe('migrateFileStore', () => {
  /** Build a throwaway data dir with one deck, one version and one library item. */
  async function seed() {
    const root = await mkdtemp(path.join(tmpdir(), 'deckyard-lijstje-'));
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
        { id: 's1', type: 'title-slide', content: { title: 'Hallo' } },
        {
          id: 's2',
          type: OLD_TYPE,
          content: { title: 'Lijstje', items: [{ text: 'een' }] },
        },
      ],
      i18n: {
        dominant: 'nl',
        versions: {
          'en-GB': {
            slides: [{ id: 's2', type: OLD_TYPE, content: { title: 'List' } }],
          },
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
            { id: 'i1', name: 'Lijstje', slideType: OLD_TYPE, content: {} },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    // A deck without the old type must not be rewritten at all.
    await writeFile(
      path.join(root, 'presentations', 'd2.json'),
      JSON.stringify(
        { id: 'd2', slides: [{ id: 's1', type: 'list-slide', content: {} }] },
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
    assert.equal(stats.filesModified, 3, 'deck + version + library item');
    assert.equal(
      stats.slidesRenamed,
      5,
      '2 in the deck, 2 in its snapshot, 1 library item',
    );
    assert.equal(
      await readFile(deckPath, 'utf8'),
      before,
      'dry run must not write',
    );
  });

  it('the real run rewrites every surface, losslessly', async () => {
    const root = await seed();
    const stats = await migrateFileStore(root);
    assert.equal(stats.filesModified, 3);
    assert.equal(stats.slidesRenamed, 5);

    const deck = await readJson(path.join(root, 'presentations', 'd1.json'));
    assert.equal(deck.slides[1].type, NEW_TYPE);
    assert.deepEqual(deck.slides[1].content, {
      title: 'Lijstje',
      items: [{ text: 'een' }],
    });
    assert.equal(deck.slides[0].type, 'title-slide', 'other slides untouched');
    assert.equal(deck.i18n.versions['en-GB'].slides[0].type, NEW_TYPE);

    const version = await readJson(
      path.join(root, 'presentation-versions', 'd1', 'v1.json'),
    );
    assert.equal(version.presentation.slides[1].type, NEW_TYPE);

    const library = await readJson(
      path.join(root, 'slide-library', 'personal', 'abc.json'),
    );
    assert.equal(library.items[0].slideType, NEW_TYPE);
  });

  it('a second run is a no-op', async () => {
    const root = await seed();
    await migrateFileStore(root);
    const again = await migrateFileStore(root);
    assert.equal(again.filesModified, 0);
    assert.equal(again.slidesRenamed, 0);
  });

  it('leaves files without the old type byte-identical', async () => {
    const root = await seed();
    const untouched = path.join(root, 'presentations', 'd2.json');
    const before = await readFile(untouched, 'utf8');
    await migrateFileStore(root);
    assert.equal(await readFile(untouched, 'utf8'), before);
  });
});
