import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSlideBackgrounds,
  slideBackgroundCssVars,
  slideBackgroundsCssText,
} from '../shared/theme-slide-backgrounds.js';
import { bgClass, bgClassExtended } from '../shared/slide-types/helpers.js';
import { newSlide, validateSlide } from '../shared/slide-types/presentation.js';

test('normalizeSlideBackgrounds keeps valid entries and fills defaults', () => {
  const out = normalizeSlideBackgrounds([
    { id: 'Calm', value: ' #140a26 ', textColor: '#fff', textColorMuted: 'rgba(255,255,255,0.7)' },
    { id: 'plain-tint', value: 'linear-gradient(#fff, #eee)' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    id: 'calm',
    label: 'calm',
    value: '#140a26',
    textColor: '#fff',
    textColorMuted: 'rgba(255,255,255,0.7)',
  });
  assert.equal(out[1].label, 'plain-tint');
  assert.equal(out[1].textColor, undefined);
});

test('normalizeSlideBackgrounds drops reserved, unsafe, duplicate and empty entries', () => {
  const out = normalizeSlideBackgrounds([
    { id: 'lime', value: '#fff' }, // reserved
    { id: 'mist', value: '#fff' }, // reserved
    { id: 'has spaces', value: '#fff' }, // unsafe id
    { id: '-leading', value: '#fff' }, // unsafe id
    { id: 'calm', value: '' }, // empty value
    { id: 'calm', value: '#111}{.evil{background:red}' }, // css breakout
    { id: 'calm', value: '#111' },
    { id: 'calm', value: '#222' }, // duplicate
    'not-an-object',
    null,
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { id: 'calm', label: 'calm', value: '#111' });
});

test('normalizeSlideBackgrounds ignores textColorMuted without textColor', () => {
  const out = normalizeSlideBackgrounds([
    { id: 'calm', value: '#111', textColorMuted: 'rgba(0,0,0,0.5)' },
  ]);
  assert.equal(out[0].textColor, undefined);
  assert.equal(out[0].textColorMuted, undefined);
});

test('slideBackgroundCssVars emits --t-slide-bg-<id>* vars', () => {
  const vars = slideBackgroundCssVars(
    normalizeSlideBackgrounds([
      { id: 'calm', value: '#140a26', textColor: '#fff', textColorMuted: 'rgba(255,255,255,0.72)' },
    ])
  );
  assert.deepEqual(vars, {
    '--t-slide-bg-calm': '#140a26',
    '--t-slide-bg-calm-text': '#fff',
    '--t-slide-bg-calm-text-muted': 'rgba(255,255,255,0.72)',
  });
});

test('slideBackgroundsCssText generates guarded rules; contrast block only with textColor', () => {
  const entries = normalizeSlideBackgrounds([
    { id: 'calm', value: '#140a26', textColor: '#fff' },
    { id: 'tint', value: '#f5f5f5' },
  ]);
  const css = slideBackgroundsCssText(entries);
  assert.match(css, /\.slide\.slide-bg-calm \{/);
  assert.match(css, /--slide-bg: var\(--t-slide-bg-calm, var\(--color-background\)\);/);
  assert.match(css, /--color-text: var\(--slide-bg-text\);/);
  assert.match(css, /\.slide\.slide-bg-tint \{/);
  // No contrast redirect for the textColor-less variant
  const tintRule = css.slice(css.indexOf('.slide.slide-bg-tint'));
  assert.doesNotMatch(tintRule, /--color-text:/);
  assert.equal(slideBackgroundsCssText([]), '');
});

test('bgClass maps theme variant ids to slide-bg-<id> and falls back to lime', () => {
  assert.equal(bgClass('calm'), 'slide-bg-calm');
  assert.equal(bgClass(' Calm '), 'slide-bg-calm');
  assert.equal(bgClass('mist'), 'slide-bg-mist');
  assert.equal(bgClass(''), 'slide-bg-lime');
  assert.equal(bgClass(), 'slide-bg-lime');
  assert.equal(bgClass('not a slug!'), 'slide-bg-lime');
  assert.equal(bgClass('"><script>'), 'slide-bg-lime');
});

test('bgClassExtended keeps built-ins and accepts variant slugs', () => {
  assert.equal(bgClassExtended('dark'), 'slide-bg-dark');
  assert.equal(bgClassExtended('brand-1'), 'slide-bg-brand-1');
  assert.equal(bgClassExtended('calm'), 'slide-bg-calm');
  assert.equal(bgClassExtended('not a slug!'), 'slide-bg-lime');
});

test('validateSlide accepts theme variant ids for the background field only', () => {
  const slide = newSlide({ type: 'content-slide' });
  slide.content.background = 'calm';
  assert.deepEqual(
    validateSlide(slide).filter((e) => e.includes('background')),
    []
  );

  slide.content.background = 'not a slug!';
  assert.equal(
    validateSlide(slide).filter((e) => e.includes('background')).length,
    1
  );
});
