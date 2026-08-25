import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSlideBackgrounds,
  slideBackgroundContrastClass,
  slideBackgroundCssVars,
  slideBackgroundsCssText,
} from '../shared/theme-slide-backgrounds.js';
import { bgClass, bgClassExtended } from '../shared/slide-types/helpers.js';
import {
  newSlide,
  renderSlideHtml,
  validateSlide,
} from '../shared/slide-types/presentation.js';

test('normalizeSlideBackgrounds keeps valid entries and fills defaults', () => {
  const out = normalizeSlideBackgrounds([
    {
      id: 'Calm',
      value: ' #140a26 ',
      textColor: '#fff',
      textColorMuted: 'rgba(255,255,255,0.7)',
    },
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

test('normalizeSlideBackgrounds ignores textColorMuted and linkColor without textColor', () => {
  const out = normalizeSlideBackgrounds([
    {
      id: 'calm',
      value: '#111',
      textColorMuted: 'rgba(0,0,0,0.5)',
      linkColor: '#8fd0ff',
    },
  ]);
  assert.equal(out[0].textColor, undefined);
  assert.equal(out[0].textColorMuted, undefined);
  assert.equal(out[0].linkColor, undefined);
});

test('normalizeSlideBackgrounds keeps linkColor alongside textColor', () => {
  const out = normalizeSlideBackgrounds([
    { id: 'calm', value: '#140a26', textColor: '#fff', linkColor: '#8fd0ff' },
  ]);
  assert.equal(out[0].linkColor, '#8fd0ff');
});

test('slideBackgroundCssVars emits --t-slide-bg-<id>* vars', () => {
  const vars = slideBackgroundCssVars(
    normalizeSlideBackgrounds([
      {
        id: 'calm',
        value: '#140a26',
        textColor: '#fff',
        textColorMuted: 'rgba(255,255,255,0.72)',
      },
    ]),
  );
  assert.deepEqual(vars, {
    '--t-slide-bg-calm': '#140a26',
    '--t-slide-bg-calm-text': '#fff',
    '--t-slide-bg-calm-text-muted': 'rgba(255,255,255,0.72)',
  });
});

test('slideBackgroundCssVars emits --t-slide-bg-<id>-link when linkColor is set', () => {
  const vars = slideBackgroundCssVars(
    normalizeSlideBackgrounds([
      { id: 'calm', value: '#140a26', textColor: '#fff', linkColor: '#8fd0ff' },
    ]),
  );
  assert.equal(vars['--t-slide-bg-calm-link'], '#8fd0ff');
});

test('slideBackgroundsCssText generates guarded rules; contrast block only with textColor', () => {
  const entries = normalizeSlideBackgrounds([
    { id: 'calm', value: '#140a26', textColor: '#fff' },
    { id: 'tint', value: '#f5f5f5' },
  ]);
  const css = slideBackgroundsCssText(entries);
  assert.match(css, /\.slide\.slide-bg-calm \{/);
  assert.match(
    css,
    /--slide-bg: var\(--t-slide-bg-calm, var\(--slide-surface\)\);/,
  );
  assert.match(css, /--slide-on-surface: var\(--slide-bg-text\);/);
  // A text-flipping variant also redirects --slide-link, derived from the
  // accent mixed toward the variant's own text colour (no author declaration).
  assert.match(
    css,
    /--slide-link: var\(--t-slide-bg-calm-link, color-mix\(in srgb, var\(--slide-accent\) 42%, var\(--slide-bg-text\)\)\);/,
  );
  assert.match(css, /\.slide\.slide-bg-tint \{/);
  // No contrast redirect for the textColor-less variant
  const tintRule = css.slice(css.indexOf('.slide.slide-bg-tint'));
  assert.doesNotMatch(tintRule, /--slide-on-surface:/);
  assert.doesNotMatch(tintRule, /--slide-link:/);
  assert.doesNotMatch(tintRule, /--slide-on-inverted:/);
  assert.equal(slideBackgroundsCssText([]), '');
});

test('a text-flipping variant pairs the inverted plane with the opposite pole', () => {
  // The inverted plane (primary action chip, .text-block.is-black) fills with
  // --slide-on-surface, which the variant rule redirects to its text colour —
  // so the on-colour must be the opposite pole, not the root page surface.
  // Light text → light fill → dark pole, and vice versa.
  const css = slideBackgroundsCssText(
    normalizeSlideBackgrounds([
      { id: 'calm', value: '#140a26', textColor: '#ffffff' },
      { id: 'paper', value: '#f5f3ef', textColor: '#1c1917' },
    ]),
  );
  const calmRule = css.slice(
    css.indexOf('.slide.slide-bg-calm'),
    css.indexOf('.slide.slide-bg-paper'),
  );
  const paperRule = css.slice(css.indexOf('.slide.slide-bg-paper'));
  assert.match(calmRule, /--slide-on-inverted: var\(--slide-on-light\);/);
  assert.match(paperRule, /--slide-on-inverted: var\(--slide-on-dark\);/);
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
    [],
  );

  slide.content.background = 'not a slug!';
  assert.equal(
    validateSlide(slide).filter((e) => e.includes('background')).length,
    1,
  );
});

const CONTRAST_ENTRIES = normalizeSlideBackgrounds([
  { id: 'calm', value: '#140a26', textColor: '#ffffff' },
  { id: 'paper', value: '#f6f3ec', textColor: '#171512' },
  { id: 'plain', value: '#cccccc' },
  { id: 'tokenised', value: '#333333', textColor: 'var(--t-color-text-light)' },
]);

test('slideBackgroundContrastClass reads the luminance a variant declares', () => {
  // A light textColor is a statement that the ground under it is dark.
  assert.equal(
    slideBackgroundContrastClass(CONTRAST_ENTRIES, 'calm'),
    'has-slide-bg-light-text',
  );
  assert.equal(
    slideBackgroundContrastClass(CONTRAST_ENTRIES, ' Paper '),
    'has-slide-bg-dark-text',
  );
  // No textColor is no declaration, and neither is one we cannot read.
  assert.equal(slideBackgroundContrastClass(CONTRAST_ENTRIES, 'plain'), '');
  assert.equal(slideBackgroundContrastClass(CONTRAST_ENTRIES, 'tokenised'), '');
  assert.equal(slideBackgroundContrastClass(CONTRAST_ENTRIES, 'nope'), '');
  assert.equal(slideBackgroundContrastClass(CONTRAST_ENTRIES, ''), '');
  assert.equal(slideBackgroundContrastClass(null, 'calm'), '');
});

test('the class it reports matches the --slide-on-inverted the generator emits', () => {
  // Both answers come from the same question — how light the variant's own
  // text is — so they may never disagree: the base class in 00-base.css sets
  // --slide-on-inverted too, on a slide the generated rule also matches.
  const css = slideBackgroundsCssText(CONTRAST_ENTRIES);
  for (const [id, pole] of [
    ['calm', 'var(--slide-on-light)'],
    ['paper', 'var(--slide-on-dark)'],
  ]) {
    const rule = css.slice(css.indexOf(`.slide.slide-bg-${id}`));
    const cls = slideBackgroundContrastClass(CONTRAST_ENTRIES, id);
    assert.match(
      rule,
      new RegExp(`--slide-on-inverted: ${pole.replace(/[()]/g, '\\$&')};`),
    );
    assert.equal(
      cls,
      pole === 'var(--slide-on-light)'
        ? 'has-slide-bg-light-text'
        : 'has-slide-bg-dark-text',
    );
  }
});

const contrastTheme = { slideBackgrounds: CONTRAST_ENTRIES };

function renderWith(content, ctx = {}) {
  const slide = newSlide({ type: 'content-slide' });
  Object.assign(slide.content, content);
  return renderSlideHtml(slide, { theme: contrastTheme, ...ctx });
}

test('renderSlideHtml publishes a variant luminance on the slide root', () => {
  assert.match(
    renderWith({ background: 'calm' }),
    /class="slide[^"]*\bslide-bg-calm\b[^"]*\bhas-slide-bg-light-text\b/,
  );
  assert.match(
    renderWith({ background: 'paper' }),
    /class="slide[^"]*\bhas-slide-bg-dark-text\b/,
  );
});

test('a variant that declares no luminance gets no class', () => {
  for (const background of ['plain', 'tokenised', 'lime', 'mist', '']) {
    assert.doesNotMatch(
      renderWith({ background }),
      /has-slide-bg-(light|dark)-text/,
      `background "${background}" must not claim a luminance`,
    );
  }
  // No theme in context is no answer either — that is today's behaviour.
  assert.doesNotMatch(
    renderSlideHtml(
      Object.assign(newSlide({ type: 'content-slide' }), {
        content: { background: 'calm' },
      }),
      {},
    ),
    /has-slide-bg-(light|dark)-text/,
  );
});

test('a background image outranks the variant it covers', () => {
  // The image IS the ground the text sits on, so its own answer wins.
  const forced = renderWith({
    background: 'calm',
    slideBgImage: '/uploads/photo.jpg',
    slideBgText: 'dark',
  });
  assert.match(forced, /has-slide-bg-dark-text/);
  assert.doesNotMatch(forced, /has-slide-bg-light-text/);

  // An image with no contrast answer of its own leaves the variant's standing.
  assert.match(
    renderWith({
      background: 'calm',
      slideBgImage: '/uploads/photo.jpg',
      slideBgText: 'default',
    }),
    /has-slide-bg-light-text/,
  );
});
