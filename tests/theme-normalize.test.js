/**
 * Tests for the shared theme normalizer.
 *
 * `shared/theme-normalize.js` replaced two near-identical private copies (one in
 * client/lib/theme.js, one in server/utils/themes.js) that had drifted apart —
 * the client copy never gained the table-variant contrast derivation, so a table
 * slide could read fine in an export and be unreadable in the editor. These
 * tests pin the derivations that both sides now share.
 *
 * Run with: node --test tests/theme-normalize.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTheme,
  hexToRgb,
  pickTextColorForBg,
} from '../shared/theme-normalize.js';
import { getContrastRatio } from '../shared/color-utils.js';

const baseTheme = () => ({
  id: 'test',
  label: 'Test',
  cssVars: {
    '--t-color-accent': '#7c3aed',
    '--t-color-text': '#0b0b0b',
    '--t-slide-bg-dark': '#2e1065',
    '--t-slide-bg-lime': '#e2fe52',
    '--t-slide-bg-mist': '#e0e6e2',
  },
});

test('does not mutate its input and returns a clone', () => {
  const input = baseTheme();
  const before = structuredClone(input);
  const out = normalizeTheme(input);

  assert.deepEqual(input, before, 'input theme was mutated');
  assert.notEqual(out, input);
  assert.ok(out.cssVars['--t-color-accent-contrast']);
});

test('non-object input passes through untouched', () => {
  assert.equal(normalizeTheme(null), null);
  assert.equal(normalizeTheme(undefined), undefined);
  assert.equal(normalizeTheme('nope'), 'nope');
});

test('is idempotent — normalizing twice changes nothing', () => {
  const once = normalizeTheme(baseTheme());
  const twice = normalizeTheme(once);
  assert.deepEqual(twice, once);
});

test('the per-type table token family is no longer derived', () => {
  // The --t-table-* family was removed (B2/B3): table CSS composes the
  // emphasis/surface roles, so normalize must not resurrect the family even
  // when a stale theme still carries a table background token.
  const out = normalizeTheme({
    ...baseTheme(),
    cssVars: {
      ...baseTheme().cssVars,
      '--t-table-panel-header-bg': '#111111',
    },
  });
  assert.equal(out.cssVars['--t-table-panel-header-text'], undefined);
});

test('emits the legacy alias family derived from the theme', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    brandColors: ['#5b21b6', '#7c3aed', '#a78bfa', '#c4b5fd'],
  });

  // Countdown / end-slide CSS reads these; nothing emitted them
  // before, so those slides always painted the stylesheet's hardcoded purple.
  assert.equal(out.cssVars['--t-primary'], '#7c3aed');
  assert.equal(out.cssVars['--t-accent'], '#7c3aed');
  assert.equal(out.cssVars['--t-bg-dark'], '#2e1065');
  assert.equal(out.cssVars['--t-brand-1'], '#7c3aed');
  assert.equal(out.cssVars['--t-brand-2'], '#a78bfa');
});

test('aliases fall back to the accent when brandColors are missing', () => {
  const out = normalizeTheme(baseTheme());
  assert.equal(out.cssVars['--t-brand-1'], '#7c3aed');
  assert.equal(out.cssVars['--t-brand-2'], '#7c3aed');
});

test('a theme that sets an alias explicitly still wins', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    brandColors: ['#5b21b6', '#7c3aed', '#a78bfa'],
    cssVars: { ...baseTheme().cssVars, '--t-brand-1': '#00ff00' },
  });
  assert.equal(out.cssVars['--t-brand-1'], '#00ff00');
});

test('the dark-surface text derives from the dark surface, not the page text', () => {
  // Regression guard: deriving from --t-color-text paints dark-on-dark on the
  // quote/chapter ground. --slide-on-bg-dark reads this token.
  const out = normalizeTheme(baseTheme());
  assert.equal(out.cssVars['--t-slide-bg-dark-text'], '#ffffff');

  const lightSurface = normalizeTheme({
    ...baseTheme(),
    cssVars: { ...baseTheme().cssVars, '--t-slide-bg-dark': '#fafafa' },
  });
  assert.equal(lightSurface.cssVars['--t-slide-bg-dark-text'], '#212121');
});

test('an explicit dark-surface text token is never overwritten', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    cssVars: { ...baseTheme().cssVars, '--t-slide-bg-dark-text': '#fafafa' },
  });
  assert.equal(out.cssVars['--t-slide-bg-dark-text'], '#fafafa');
});

test('an unparseable dark surface falls back to the CSS var expression', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    cssVars: { ...baseTheme().cssVars, '--t-slide-bg-dark': 'not-a-colour' },
  });
  assert.equal(
    out.cssVars['--t-slide-bg-dark-text'],
    'var(--t-color-text, #0b0b0b)'
  );
});

test('gradient off emits 0 and generates no gradient background', () => {
  const out = normalizeTheme(baseTheme());
  assert.equal(out.cssVars['--t-gradient-enabled'], '0');
  assert.equal(out.cssVars['--t-slide-gradient-bg'], undefined);
});

test('gradient on generates a background from the theme tokens', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    gradient: { enabled: true },
    cssVars: { ...baseTheme().cssVars, '--t-color-accent-on-dark': '#c4b5fd' },
  });

  assert.equal(out.cssVars['--t-gradient-enabled'], '1');
  assert.match(out.cssVars['--t-slide-gradient-bg'], /^radial-gradient\(/);
  assert.ok(out.cssVars['--t-slide-gradient-bg'].endsWith('#06090b'));
  // Gradient themes force white on the deep gradient ground rather than a
  // luminance pick, and emit the gradient text pair for --slide-on-gradient.
  assert.equal(out.cssVars['--t-slide-bg-dark-text'], '#ffffff');
  assert.equal(out.cssVars['--t-slide-gradient-text'], '#ffffff');
  assert.equal(
    out.cssVars['--t-slide-gradient-text-muted'],
    'rgba(255, 255, 255, 0.82)'
  );
});

test('gradient off emits no gradient text pair', () => {
  const out = normalizeTheme(baseTheme());
  assert.equal(out.cssVars['--t-slide-gradient-text'], undefined);
  assert.equal(out.cssVars['--t-slide-gradient-text-muted'], undefined);
});

test('gradient generation is skipped when a source colour is unparseable', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    gradient: { enabled: true },
    cssVars: { ...baseTheme().cssVars, '--t-color-accent-on-dark': 'garbage' },
  });
  assert.equal(out.cssVars['--t-slide-gradient-bg'], undefined);
});

test('legacy hiddenSlideTypes folds into slideTypes.exclude, deduped, and is dropped', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    hiddenSlideTypes: ['quote-slide', ' quote-slide ', 'video-slide'],
    slideTypes: { exclude: ['video-slide'], include: ['content-slide', ''] },
  });

  assert.deepEqual(out.slideTypes.exclude, ['video-slide', 'quote-slide']);
  assert.deepEqual(out.slideTypes.include, ['content-slide']);
  // Normalize-and-remove: one canonical spelling survives normalization, so no
  // consumer can read a second field meaning the same thing.
  assert.ok(
    !('hiddenSlideTypes' in out),
    'the legacy alias must not survive normalization'
  );
});

test('a theme carrying only the legacy alias still ends up excluded', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    hiddenSlideTypes: ['lead-capture-slide'],
  });

  assert.deepEqual(out.slideTypes.exclude, ['lead-capture-slide']);
  assert.ok(!('hiddenSlideTypes' in out));
});

test('defaultTitleSlide falls back to title-slide', () => {
  assert.equal(normalizeTheme(baseTheme()).defaultTitleSlide, 'title-slide');
  assert.equal(
    normalizeTheme({ ...baseTheme(), defaultTitleSlide: '  custom-title  ' })
      .defaultTitleSlide,
    'custom-title'
  );
});

test('slideBackgrounds become --t-slide-bg-<id> vars', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    slideBackgrounds: [
      { id: 'calm', label: 'Calm', value: '#e8f0ee', textColor: '#0b0b0b' },
      { id: 'lime', label: 'Reserved id is dropped', value: '#000' },
    ],
  });

  assert.equal(out.cssVars['--t-slide-bg-calm'], '#e8f0ee');
  assert.equal(out.cssVars['--t-slide-bg-calm-text'], '#0b0b0b');
  assert.deepEqual(
    out.slideBackgrounds.map((b) => b.id),
    ['calm']
  );
});

test('the soft accent plane takes a bright mist and pairs a readable foreground', () => {
  const out = normalizeTheme(baseTheme());
  assert.equal(out.cssVars['--t-color-accent-soft'], '#e0e6e2');
  assert.equal(out.cssVars['--t-color-accent-soft-contrast'], '#212121');
});

test('a dark mist hands the soft accent plane to the accent itself', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    cssVars: { ...baseTheme().cssVars, '--t-slide-bg-mist': '#27272a' },
  });
  assert.equal(out.cssVars['--t-color-accent-soft'], '#7c3aed');
  assert.equal(out.cssVars['--t-color-accent-soft-contrast'], '#ffffff');
});

test('an explicit soft accent plane is never overwritten', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    cssVars: { ...baseTheme().cssVars, '--t-color-accent-soft': '#123456' },
  });
  assert.equal(out.cssVars['--t-color-accent-soft'], '#123456');
  assert.equal(out.cssVars['--t-color-accent-soft-contrast'], '#ffffff');
});

test('the per-type icon-card-grid token family is no longer derived', () => {
  const out = normalizeTheme(baseTheme());
  const icgKeys = Object.keys(out.cssVars).filter((k) =>
    k.startsWith('--t-icon-card-grid-')
  );
  assert.deepEqual(icgKeys, []);
});

test('custom text poles drive every contrast decision', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    textColorLight: '#fffbea',
    textColorDark: '#1a1a1a',
  });
  assert.equal(out.cssVars['--t-text-color-light'], '#fffbea');
  assert.equal(out.cssVars['--t-text-color-dark'], '#1a1a1a');
  assert.equal(out.cssVars['--t-color-accent-contrast'], '#fffbea');
});

test('hexToRgb parses 3- and 6-digit hex, with or without #', () => {
  assert.deepEqual(hexToRgb('#ffffff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb('000000'), { r: 0, g: 0, b: 0 });
  // The old client copy only handled 6-digit; the server copy handled both.
  assert.deepEqual(hexToRgb('#f00'), { r: 255, g: 0, b: 0 });
  assert.equal(hexToRgb('rebeccapurple'), null);
  assert.equal(hexToRgb(''), null);
  assert.equal(hexToRgb(null), null);
});

test('pickTextColorForBg falls back to the dark pole for unparseable input', () => {
  assert.equal(pickTextColorForBg('#000000'), '#ffffff');
  assert.equal(pickTextColorForBg('#ffffff'), '#212121');
  assert.equal(pickTextColorForBg('nonsense'), '#212121');
  assert.equal(pickTextColorForBg('nonsense', { dark: '#123456' }), '#123456');
});

test('pickTextColorForBg picks the higher-contrast pole, not the luminance midpoint', () => {
  // Mid-light backgrounds: a midpoint split (L < 0.5) would hand these white
  // text at 2.2-2.7:1. Measuring both poles picks dark, which clears AA.
  for (const bg of ['#a78bfa', '#10b981', '#f59e0b', '#3b82f6']) {
    assert.equal(pickTextColorForBg(bg), '#212121', `${bg} should take dark text`);
    assert.ok(
      getContrastRatio(bg, '#212121') > getContrastRatio(bg, '#ffffff'),
      `${bg}: dark pole should win on ratio`
    );
  }
  // Genuinely dark backgrounds keep light text.
  for (const bg of ['#7c3aed', '#1e1b4b', '#111827']) {
    assert.equal(pickTextColorForBg(bg), '#ffffff', `${bg} should take light text`);
  }
});

test('pickTextColorForBg honours custom poles when measuring', () => {
  // A dark "light" pole loses to white on a near-black background.
  assert.equal(
    pickTextColorForBg('#000000', { light: '#333333', dark: '#ffffff' }),
    '#ffffff'
  );
});

test('normalizeTheme keeps only valid, token-backed textSwatches', () => {
  const out = normalizeTheme({
    id: 't',
    label: 'T',
    cssVars: {
      '--t-color-accent': '#7c3aed',
      '--t-color-brand-1': '#db2777',
      '--t-color-brand-2': '#c2410c',
    },
    textSwatches: [
      { id: 'brand-1', label: { en: 'Pink', nl: 'Roze' } }, // valid + token present
      'brand-2',                                             // string form, token present
      { id: 'brand-3' },                                     // valid slot but NO token → dropped
      { id: 'brand-1' },                                     // duplicate → dropped
      { id: 'accent' },                                      // not a swatch slot → dropped
      { id: 'lime' },                                        // unknown slot → dropped
      'garbage',
    ],
  });
  assert.deepEqual(out.textSwatches, [
    { id: 'brand-1', label: { en: 'Pink', nl: 'Roze' } },
    { id: 'brand-2' },
  ]);
});

test('normalizeTheme defaults textSwatches to an empty array', () => {
  const out = normalizeTheme({ id: 't', label: 'T', cssVars: {} });
  assert.deepEqual(out.textSwatches, []);
  const out2 = normalizeTheme({ id: 't', label: 'T', cssVars: {}, textSwatches: 'nope' });
  assert.deepEqual(out2.textSwatches, []);
});

test('normalizeTheme defaults titleLayout to bottom and validates the token', () => {
  const base = normalizeTheme({ id: 't', label: 'T', cssVars: {} });
  assert.equal(base.titleLayout, 'bottom');

  for (const v of ['bottom', 'center', 'top']) {
    const out = normalizeTheme({ id: 't', label: 'T', cssVars: {}, titleLayout: v });
    assert.equal(out.titleLayout, v);
  }

  const bad = normalizeTheme({ id: 't', label: 'T', cssVars: {}, titleLayout: 'diagonal' });
  assert.equal(bad.titleLayout, 'bottom', 'unknown token falls back to default');
})
