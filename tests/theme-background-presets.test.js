/**
 * Tests for theme-owned background presets.
 *
 * `TITLE_BG_PRESETS` used to hand any title slide one of four Deckyard demo
 * photos regardless of the deck's theme, so a fork's brand decks came out
 * wearing stock imagery. `theme.backgroundPresets` is now the only mechanism,
 * and a theme that declares none yields a flat title slide by design.
 *
 * Run with: node --test tests/theme-background-presets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBackgroundPresets,
  pickBackgroundPreset,
} from '../shared/theme-background-presets.js';
import { newSlide, deckToPresentationParts, convertSlideToType } from '../shared/slide-types.js';
import * as SlideTypes from '../shared/slide-types.js';

const PRESETS = ['/custom/a.jpg', '/custom/b.jpg'];
const themeWithPresets = { id: 't', backgroundPresets: PRESETS };
const themeWithout = { id: 't', backgroundPresets: [] };

test('getBackgroundPresets reads the theme and drops junk entries', () => {
  assert.deepEqual(getBackgroundPresets(themeWithPresets), PRESETS);
  assert.deepEqual(getBackgroundPresets(themeWithout), []);
  assert.deepEqual(getBackgroundPresets(null), []);
  assert.deepEqual(getBackgroundPresets({}), []);
  assert.deepEqual(getBackgroundPresets({ backgroundPresets: 'nope' }), []);
  assert.deepEqual(
    getBackgroundPresets({ backgroundPresets: ['/a.jpg', '', '   ', 42, null] }),
    ['/a.jpg']
  );
});

test('pickBackgroundPreset only ever returns a URL the theme declared', () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(PRESETS.includes(pickBackgroundPreset(themeWithPresets)));
  }
});

test('pickBackgroundPreset returns empty without a theme or presets', () => {
  assert.equal(pickBackgroundPreset(themeWithout), '');
  assert.equal(pickBackgroundPreset(null), '');
  assert.equal(pickBackgroundPreset(undefined), '');
  assert.equal(pickBackgroundPreset({}), '');
});

test('newSlide without a theme creates a title slide with no background', () => {
  const slide = newSlide({ type: 'title-slide' });
  assert.equal(slide.content.bgImage, '');
});

test('newSlide still works for every type without a theme', () => {
  // Guards the `theme` parameter default — this used to take no theme at all.
  for (const type of ['title-slide', 'content-slide', 'quote-slide']) {
    assert.doesNotThrow(() => newSlide({ type }));
  }
});

test('imported title slides take a background from the theme, or none', () => {
  const deck = {
    title: 'Imported',
    slides: [{ type: 'title-slide', content: { title: 'Hello' } }],
  };

  const withTheme = deckToPresentationParts(deck, { theme: themeWithPresets });
  assert.ok(PRESETS.includes(withTheme.slides[0].content.bgImage));

  // The behaviour change: a theme with no presets leaves the slide flat rather
  // than reaching for a demo photo.
  const withoutTheme = deckToPresentationParts(deck, { theme: themeWithout });
  assert.equal(withoutTheme.slides[0].content.bgImage, '');

  const noThemeAtAll = deckToPresentationParts(deck);
  assert.equal(noThemeAtAll.slides[0].content.bgImage, '');
});

test('an imported title slide keeps a background it already declares', () => {
  const parts = deckToPresentationParts(
    {
      slides: [
        { type: 'title-slide', content: { title: 'X', bgImage: '/mine.jpg' } },
      ],
    },
    { theme: themeWithPresets }
  );
  assert.equal(parts.slides[0].content.bgImage, '/mine.jpg');
});

test('chapter-title → title conversion takes its background from the theme', () => {
  const slide = {
    id: 'a',
    type: 'chapter-title-slide',
    content: { title: 'Chapter one' },
  };

  const converted = convertSlideToType(slide, 'title-slide', {
    theme: themeWithPresets,
  });
  assert.equal(converted.type, 'title-slide');
  assert.equal(converted.content.title, 'Chapter one');
  assert.ok(PRESETS.includes(converted.content.bgImage));

  const flat = convertSlideToType(slide, 'title-slide');
  assert.equal(flat.content.bgImage, '');
});

test('the title-slide import path never reaches for a demo photo', () => {
  // The point of the slice: with no theme context, nothing hands the slide a
  // background image that the theme did not ask for.
  const parts = deckToPresentationParts({
    slides: [{ type: 'title-slide', content: { title: 'A' } }],
  });

  assert.doesNotMatch(
    JSON.stringify(parts.slides[0].content),
    /demo-(aurora|dusk|paper|moss)/
  );
});

test('split-partner-title no longer ships a hardcoded demo background', () => {
  // The last hardcoded Deckyard demo photo in a shared slide path: it was both
  // the field default and the render fallback, so the slide always wore stock
  // imagery whatever the deck's theme.
  const slide = newSlide({ type: 'split-partner-title-slide' });
  assert.equal(slide.content.bgImage, '');
  assert.doesNotMatch(JSON.stringify(slide.content), /demo-(aurora|dusk|paper|moss)/);
});

test('split-partner-title renders no image and no scrim without a background', () => {
  const { SLIDE_TYPES } = SlideTypes;
  const html = SLIDE_TYPES['split-partner-title-slide'].renderHtml({
    title: 'T',
    logos: [],
  });

  assert.doesNotMatch(html, /<img class="bg"/);
  // The overlay is a scrim for photo legibility; on a bare panel it is a smear.
  assert.doesNotMatch(html, /class="overlay"/);
});

test('split-partner-title still renders image and scrim when given one', () => {
  const { SLIDE_TYPES } = SlideTypes;
  const html = SLIDE_TYPES['split-partner-title-slide'].renderHtml({
    title: 'T',
    logos: [],
    bgImage: '/custom/photo.jpg',
  });

  assert.match(html, /<img class="bg" src="\/custom\/photo.jpg"/);
  assert.match(html, /class="overlay"/);
});
