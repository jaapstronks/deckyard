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
import {
  newSlide,
  deckToPresentationParts,
  convertSlideToType,
} from '../shared/slide-types.js';
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
    getBackgroundPresets({
      backgroundPresets: ['/a.jpg', '', '   ', 42, null],
    }),
    ['/a.jpg'],
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
  // Canonical key is slideBgImage; the core title type has no
  // autoBackgroundPreset, so a new slide simply carries no background.
  assert.ok(!slide.content.slideBgImage);
  assert.ok(!slide.content.bgImage);
});

test('newSlide works for every registered type without a theme, and none seed a background', () => {
  // Two invariants over the whole registry, replacing a three-type sample:
  //  1. the `theme` parameter default holds — newSlide never throws without a
  //     theme (it used to take no theme at all);
  //  2. no type hands ITSELF a background without a theme asking for it. This
  //     generalises the split-partner regression: that type had a hardcoded
  //     Deckyard demo photo as both its field default and render fallback, so a
  //     new slide always wore stock imagery. #480 removed the per-type assertion
  //     with the type; here it becomes one registry-wide guard, so any future
  //     type reintroducing a hardcoded background — demo photo or otherwise —
  //     fails without anyone hand-listing it.
  //
  // Background is bgImage (legacy) / slideBgImage (canonical). This does NOT
  // forbid demo photos outright: gallery-slide seeds the four demo photos as
  // sample *content* images (its images[] array), which is intentional and is
  // not a background — hence the check targets the background keys, not a blanket
  // scan of content. Types declaring autoBackgroundPreset still pass: without a
  // theme pickBackgroundPreset() returns '' (see the presets tests above).
  //
  // Iterating SLIDE_TYPES keeps this zero-touch when a type is added or removed;
  // fork/custom DB types (Tier 2) are not in the static registry at test time
  // and are out of scope here by the same choice as the rest of this suite.
  const { SLIDE_TYPES } = SlideTypes;
  for (const type of Object.keys(SLIDE_TYPES)) {
    let slide;
    assert.doesNotThrow(() => {
      slide = newSlide({ type });
    }, `${type}: newSlide throws without a theme`);
    assert.ok(
      !slide.content.slideBgImage,
      `${type}: no slideBgImage seeded without a theme`,
    );
    assert.ok(
      !slide.content.bgImage,
      `${type}: no bgImage seeded without a theme`,
    );
  }
});

test('imported title slides take a background from the theme, or none', () => {
  const deck = {
    title: 'Imported',
    slides: [{ type: 'title-slide', content: { title: 'Hello' } }],
  };

  const withTheme = deckToPresentationParts(deck, { theme: themeWithPresets });
  assert.ok(PRESETS.includes(withTheme.slides[0].content.slideBgImage));

  // The behaviour change: a theme with no presets leaves the slide flat rather
  // than reaching for a demo photo.
  const withoutTheme = deckToPresentationParts(deck, { theme: themeWithout });
  assert.ok(!withoutTheme.slides[0].content.slideBgImage);

  const noThemeAtAll = deckToPresentationParts(deck);
  assert.ok(!noThemeAtAll.slides[0].content.slideBgImage);
});

test('an imported title slide keeps a legacy background it already declares', () => {
  // A deck carrying the legacy bgImage is left un-migrated (it renders via the
  // fallback and migrates on edit); no preset is stacked on top of it.
  const parts = deckToPresentationParts(
    {
      slides: [
        { type: 'title-slide', content: { title: 'X', bgImage: '/mine.jpg' } },
      ],
    },
    { theme: themeWithPresets },
  );
  assert.equal(parts.slides[0].content.bgImage, '/mine.jpg');
  assert.ok(!parts.slides[0].content.slideBgImage);
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
  assert.ok(PRESETS.includes(converted.content.slideBgImage));

  const flat = convertSlideToType(slide, 'title-slide');
  assert.ok(!flat.content.slideBgImage);
});

test('title-slide field model is title + subheading + meta (no byline/attribution)', () => {
  const { SLIDE_TYPES } = SlideTypes;
  const keys = (SLIDE_TYPES['title-slide'].fields || []).map((f) => f.key);
  assert.ok(keys.includes('title'));
  assert.ok(keys.includes('subheading'));
  assert.ok(keys.includes('meta'));
  assert.ok(!keys.includes('byline'), 'byline removed');
  assert.ok(!keys.includes('attribution'), 'attribution removed');
});

test('title-slide render maps the theme titleLayout token to a tsu-layout class', () => {
  const { SLIDE_TYPES } = SlideTypes;
  const render = (titleLayout) =>
    SLIDE_TYPES['title-slide'].renderHtml(
      { title: 'Hi' },
      { id: 's1' },
      { theme: titleLayout === undefined ? {} : { titleLayout } },
    );
  assert.match(render('center'), /tsu-layout-center/);
  assert.match(render('top'), /tsu-layout-top/);
  assert.match(render('bottom'), /tsu-layout-bottom/);
  // Absent or unknown token → the bottom default.
  assert.match(render(undefined), /tsu-layout-bottom/);
  assert.match(render('diagonal'), /tsu-layout-bottom/);
});

test('title ↔ chapter conversion carries title + subheading both ways', () => {
  const title = {
    id: 't',
    type: 'title-slide',
    content: { title: 'Cover', subheading: 'A tagline', meta: 'Jaap · 2026' },
  };
  const toChapter = convertSlideToType(title, 'chapter-title-slide');
  assert.equal(toChapter.type, 'chapter-title-slide');
  assert.equal(toChapter.content.title, 'Cover');
  assert.equal(toChapter.content.subheading, 'A tagline');
  // chapter has no meta field, so it drops (and would warn as lossy)
  assert.ok(!('meta' in toChapter.content) || !toChapter.content.meta);

  const back = convertSlideToType(
    {
      id: 'c',
      type: 'chapter-title-slide',
      content: { title: 'Section', subheading: 'Sub' },
    },
    'title-slide',
  );
  assert.equal(back.type, 'title-slide');
  assert.equal(back.content.title, 'Section');
  assert.equal(back.content.subheading, 'Sub');
});

test('the title-slide import path never reaches for a demo photo', () => {
  // The point of the slice: with no theme context, nothing hands the slide a
  // background image that the theme did not ask for.
  const parts = deckToPresentationParts({
    slides: [{ type: 'title-slide', content: { title: 'A' } }],
  });

  assert.doesNotMatch(
    JSON.stringify(parts.slides[0].content),
    /demo-(aurora|dusk|paper|moss)/,
  );
});
