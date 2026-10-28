/**
 * An imported or AI-made slide never takes its pictures from the type's
 * insert defaults (B862). A gallery whose `images` the deck leaves out used to
 * compose the four demo photos, so stock imagery reached the presentation and
 * every export past the empty-picture rule (B590). Now the list keeps its
 * default slots with the picture cleared: the slide is incomplete and the
 * author picks one. An editor insert (`newSlide()` without a patch) still gets
 * the demo photos.
 *
 * Run with: node --test tests/deck-import-no-default-pictures.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deckToPresentationParts } from '../shared/slide-types/deck.js';
import {
  newSlide,
  validateSlideFields,
} from '../shared/slide-types/presentation.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { isSlideIncomplete } from '../shared/incomplete-slides.js';

const importOne = (slide, options) =>
  deckToPresentationParts(
    { title: 'T', slides: [slide] },
    { slideTypes: SLIDE_TYPES, ...options },
  ).slides[0];

const sources = (slide) => slide.content.images.map((item) => item.src);

for (const lang of [null, 'nl', 'en-GB']) {
  test(`a gallery without images imports without demo photos (lang ${lang})`, () => {
    const slide = importOne(
      { type: 'gallery-slide', content: { title: 'Ons team' } },
      { lang },
    );
    assert.equal(slide.content.title, 'Ons team');
    assert.ok(slide.content.images.length > 0, 'the empty slots stay');
    assert.deepEqual(
      sources(slide).filter(Boolean),
      [],
      'no picture comes from the defaults',
    );
    assert.equal(isSlideIncomplete(slide, SLIDE_TYPES), true);
    // The empty slots are storable: the write seam runs this check (B866).
    assert.deepEqual(
      validateSlideFields(slide, { slideTypes: SLIDE_TYPES }),
      [],
    );
  });
}

test('a gallery the deck fills keeps its own pictures', () => {
  const slide = importOne({
    type: 'gallery-slide',
    content: { images: [{ src: '/uploads/a.jpg', caption: 'A', alt: 'A' }] },
  });
  assert.deepEqual(sources(slide), ['/uploads/a.jpg']);
  assert.equal(isSlideIncomplete(slide, SLIDE_TYPES), false);
});

test('an editor insert still gets the demo photos', () => {
  for (const lang of [null, 'nl']) {
    const slide = newSlide({
      type: 'gallery-slide',
      lang,
      slideTypes: SLIDE_TYPES,
    });
    assert.ok(sources(slide).length > 0);
    assert.ok(sources(slide).every((src) => src.includes('/demo-')));
  }
});
