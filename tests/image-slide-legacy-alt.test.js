/**
 * image-slide has one spelling for its alt text (B257, 80th audit).
 *
 * The resolver used to read `alt || altNl || altEn`, so a deck from before the
 * per-language alt was dropped kept two more spellings alive in every reader.
 * Schema v20 -> v21 (`foldImageSlideLegacyAlt`) folds them into `alt` once and
 * deletes them; the resolver reads `alt` alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { migratePresentation } from '../shared/slide-types/schema-version.js';
import { imageSlideAltText } from '../shared/slide-types/types/image-slide/image.js';

/** Run one image-slide's content through the read funnel; returns it. */
const fold = (content) =>
  migratePresentation({ slides: [{ type: 'image-slide', content }] }).slides[0]
    .content;

test('funnel: a legacy altNl becomes alt and both legacy keys go', () => {
  const content = fold({ image: '/a.png', altNl: ' Een kat ', altEn: 'A cat' });
  assert.equal(content.alt, 'Een kat');
  assert.equal(Object.hasOwn(content, 'altNl'), false);
  assert.equal(Object.hasOwn(content, 'altEn'), false);
});

test('funnel: altEn fills alt when altNl is empty', () => {
  const content = fold({ image: '/a.png', altNl: '  ', altEn: 'A cat' });
  assert.equal(content.alt, 'A cat');
});

test('funnel: an own alt wins over the legacy values', () => {
  const content = fold({ image: '/a.png', alt: 'Own', altNl: 'Legacy' });
  assert.deepEqual(content, { image: '/a.png', alt: 'Own' });
});

test('funnel: empty legacy keys are deleted without stamping an alt', () => {
  const content = fold({ image: '/a.png', altNl: '', altEn: null });
  assert.deepEqual(content, { image: '/a.png' });
});

test('funnel: the fold is render-equivalent', () => {
  const before = { image: '/a.png', caption: 'Caption', altEn: 'A cat' };
  const content = fold(structuredClone(before));
  assert.equal(imageSlideAltText(content), 'A cat');
});

test('funnel: every language version is folded, other types untouched', () => {
  const pres = migratePresentation({
    slides: [{ type: 'image-slide', content: { altNl: 'Kat' } }],
    i18n: {
      versions: {
        'en-GB': {
          slides: [
            { type: 'image-slide', content: { altEn: 'Cat' } },
            { type: 'quote-slide', content: { altNl: 'blijft' } },
          ],
        },
      },
    },
  });
  assert.deepEqual(pres.slides[0].content, { alt: 'Kat' });
  const [en, other] = pres.i18n.versions['en-GB'].slides;
  assert.deepEqual(en.content, { alt: 'Cat' });
  assert.equal(other.content.altNl, 'blijft', 'another type is not touched');
});

test('funnel: idempotent and a no-op on the current shape', () => {
  const current = { image: '/a.png', alt: 'A cat' };
  assert.deepEqual(fold(structuredClone(current)), current);
  const once = fold({ image: '/a.png', altNl: 'Kat' });
  assert.deepEqual(fold(structuredClone(once)), once);
});

test('resolve: altNl and altEn are no longer read', () => {
  assert.equal(
    imageSlideAltText({ image: '/cat.png', altNl: 'Kat', caption: 'Caption' }),
    'Caption',
  );
});
