/**
 * Composing a new deck from library slides must keep both languages.
 *
 * Covers the two halves of the round-trip:
 * - buildSlidesFromLibraryItems (client): forwards per-language content as
 *   `contentByLang` when a library item has i18n versions.
 * - prepareNewPresentation (server): expands `contentByLang` into one i18n
 *   version per language, sharing a stable slide id across versions, and falls
 *   back to a single version when no multilingual content is present.
 *
 * Run with: node --test tests/slide-library-compose-i18n.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSlidesFromLibraryItems } from '../client/lib/slide-library/compose.js';
import { prepareNewPresentation } from '../server/storage/presentations/crud/factory.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('buildSlidesFromLibraryItems', () => {
  it('forwards both languages as contentByLang when the item has i18n versions', () => {
    const items = [
      {
        slideType: 'content-slide',
        content: { title: 'Hallo' },
        i18n: {
          versions: {
            nl: { content: { title: 'Hallo' } },
            'en-GB': { content: { title: 'Hello' } },
          },
        },
      },
    ];
    const slides = buildSlidesFromLibraryItems(items);
    assert.strictEqual(slides.length, 1);
    assert.strictEqual(slides[0].type, 'content-slide');
    assert.deepStrictEqual(slides[0].contentByLang.nl, { title: 'Hallo' });
    assert.deepStrictEqual(slides[0].contentByLang['en-GB'], { title: 'Hello' });
  });

  it('omits contentByLang for a single-language item', () => {
    const slides = buildSlidesFromLibraryItems([
      { slideType: 'content-slide', content: { title: 'Solo' } },
    ]);
    assert.strictEqual(slides[0].contentByLang, undefined);
    assert.deepStrictEqual(slides[0].content, { title: 'Solo' });
  });
});

describe('prepareNewPresentation multilingual compose', () => {
  it('builds one i18n version per language, sharing slide ids', async () => {
    const slides = buildSlidesFromLibraryItems([
      {
        slideType: 'content-slide',
        content: { title: 'Hallo' },
        i18n: {
          versions: {
            nl: { content: { title: 'Hallo' } },
            'en-GB': { content: { title: 'Hello' } },
          },
        },
      },
    ]);

    const pres = await prepareNewPresentation(repoRoot, {
      title: 'Composed deck',
      slides,
      theme: 'deckyard',
      lang: 'nl',
    });

    // Both language versions exist.
    assert.ok(pres.i18n.versions.nl, 'nl version present');
    assert.ok(pres.i18n.versions['en-GB'], 'en-GB version present');
    assert.strictEqual(pres.i18n.dominant, 'nl');

    const nlSlide = pres.i18n.versions.nl.slides[0];
    const enSlide = pres.i18n.versions['en-GB'].slides[0];
    assert.strictEqual(nlSlide.content.title, 'Hallo');
    assert.strictEqual(enSlide.content.title, 'Hello');
    // Same slide, two translations → identical id.
    assert.strictEqual(nlSlide.id, enSlide.id);

    // Top-level slides reflect the dominant language.
    assert.strictEqual(pres.slides[0].content.title, 'Hallo');
  });

  it('respects en-GB as the dominant language', async () => {
    const slides = buildSlidesFromLibraryItems([
      {
        slideType: 'content-slide',
        content: { title: 'Hallo' },
        i18n: {
          versions: {
            nl: { content: { title: 'Hallo' } },
            'en-GB': { content: { title: 'Hello' } },
          },
        },
      },
    ]);
    const pres = await prepareNewPresentation(repoRoot, {
      title: 'Composed deck',
      slides,
      theme: 'deckyard',
      lang: 'en-GB',
    });
    assert.strictEqual(pres.i18n.dominant, 'en-GB');
    assert.strictEqual(pres.slides[0].content.title, 'Hello');
    assert.ok(pres.i18n.versions.nl, 'nl version still preserved');
  });

  it('falls back to a single version for single-language slides', async () => {
    const slides = buildSlidesFromLibraryItems([
      { slideType: 'content-slide', content: { title: 'Solo' } },
    ]);
    const pres = await prepareNewPresentation(repoRoot, {
      title: 'Composed deck',
      slides,
      theme: 'deckyard',
      lang: 'nl',
    });
    assert.ok(pres.i18n.versions.nl, 'nl version present');
    assert.strictEqual(pres.i18n.versions['en-GB'], undefined, 'no en-GB version invented');
    assert.strictEqual(pres.slides[0].content.title, 'Solo');
  });
});
