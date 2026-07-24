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

test('derives readable text for table variant backgrounds (the drifted derivation)', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    cssVars: {
      ...baseTheme().cssVars,
      '--t-table-panel-header-bg': '#111111', // dark → light text
      '--t-table-soft-firstcol-bg': '#fafafa', // light → dark text
      '--t-table-panel-bg': '#000000', // body surface, slot-less pair
    },
  });

  assert.equal(out.cssVars['--t-table-panel-header-text'], '#ffffff');
  assert.equal(out.cssVars['--t-table-soft-firstcol-text'], '#212121');
  assert.equal(out.cssVars['--t-table-panel-text'], '#ffffff');
});

test('an explicit table text token is never overwritten', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    cssVars: {
      ...baseTheme().cssVars,
      '--t-table-panel-header-bg': '#111111',
      '--t-table-panel-header-text': '#ff0000',
    },
  });
  assert.equal(out.cssVars['--t-table-panel-header-text'], '#ff0000');
});

test('table tokens stay absent when the theme sets no table backgrounds', () => {
  const out = normalizeTheme(baseTheme());
  const tableKeys = Object.keys(out.cssVars).filter((k) =>
    k.startsWith('--t-table-')
  );
  assert.deepEqual(tableKeys, []);
});

test('emits the legacy alias family derived from the theme', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    brandColors: ['#5b21b6', '#7c3aed', '#a78bfa', '#c4b5fd'],
  });

  // Countdown / freeform / end-slide CSS reads these; nothing emitted them
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

test('chapter and quote text derive from the dark surface, not the page text', () => {
  // Regression guard: deriving from --t-color-text paints dark-on-dark here.
  const out = normalizeTheme(baseTheme());
  assert.equal(out.cssVars['--t-chapter-text-color'], '#ffffff');
  assert.equal(out.cssVars['--t-quote-text-color'], '#ffffff');

  const lightSurface = normalizeTheme({
    ...baseTheme(),
    cssVars: { ...baseTheme().cssVars, '--t-slide-bg-dark': '#fafafa' },
  });
  assert.equal(lightSurface.cssVars['--t-chapter-text-color'], '#212121');
});

test('an unparseable dark surface falls back to the CSS var expression', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    cssVars: { ...baseTheme().cssVars, '--t-slide-bg-dark': 'not-a-colour' },
  });
  assert.equal(
    out.cssVars['--t-chapter-text-color'],
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
    cssVars: { ...baseTheme().cssVars, '--t-quote-author-color': '#c4b5fd' },
  });

  assert.equal(out.cssVars['--t-gradient-enabled'], '1');
  assert.match(out.cssVars['--t-slide-gradient-bg'], /^radial-gradient\(/);
  assert.ok(out.cssVars['--t-slide-gradient-bg'].endsWith('#06090b'));
  // Gradient themes get white chapter text rather than a luminance pick.
  assert.equal(out.cssVars['--t-chapter-text-color'], '#ffffff');
});

test('gradient generation is skipped when a source colour is unparseable', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    gradient: { enabled: true },
    cssVars: { ...baseTheme().cssVars, '--t-quote-author-color': 'garbage' },
  });
  assert.equal(out.cssVars['--t-slide-gradient-bg'], undefined);
});

test('hiddenSlideTypes merges into slideTypes.exclude, deduped', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    hiddenSlideTypes: ['quote-slide', ' quote-slide ', 'video-slide'],
    slideTypes: { exclude: ['video-slide'], include: ['content-slide', ''] },
  });

  assert.deepEqual(out.slideTypes.exclude, ['video-slide', 'quote-slide']);
  assert.deepEqual(out.slideTypes.include, ['content-slide']);
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

test('icon block prefers a real lime surface and picks a readable foreground', () => {
  const out = normalizeTheme(baseTheme());
  assert.equal(out.cssVars['--t-icon-card-grid-icon-bg'], '#e2fe52');
  assert.equal(out.cssVars['--t-icon-card-grid-icon-fg'], '#212121');
  assert.equal(out.cssVars['--t-icon-card-grid-icon-filter'], 'none');
});

test('a white lime surface falls back to the accent, and inverts the icon filter', () => {
  const out = normalizeTheme({
    ...baseTheme(),
    cssVars: { ...baseTheme().cssVars, '--t-slide-bg-lime': '#ffffff' },
  });
  assert.equal(out.cssVars['--t-icon-card-grid-icon-bg'], '#7c3aed');
  assert.equal(out.cssVars['--t-icon-card-grid-icon-fg'], '#ffffff');
  assert.equal(
    out.cssVars['--t-icon-card-grid-icon-filter'],
    'brightness(0) invert(1)'
  );
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
