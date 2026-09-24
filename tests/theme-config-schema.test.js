/**
 * Tests for the rich theme config schema.
 *
 * Two gates (D209). `checkThemeConfig` is the write gate: an unknown field is
 * refused by name. `validateThemeConfig` normalizes what passed it and is
 * total on the read side: junk in yields `{}` out and out-of-range enums fall
 * back rather than throwing. These tests pin both, especially the `--t-ui-*`
 * rejection — the app chrome is deliberately theme-independent and a theme
 * must not be able to restyle the application around the slides.
 *
 * Run with: node --test tests/theme-config-schema.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkThemeConfig,
  validateThemeColors,
  validateThemeConfig,
  CSS_VAR_OVERRIDE_MAX,
  DEFAULT_THEME_COLORS,
  THEME_CONFIG_VERSION,
  RADIUS_SCALES,
  SHADOW_SCALES,
  LOCKABLE_PROPERTIES,
} from '../shared/theme-config-schema.js';

test('garbage input yields an empty config, never a throw', () => {
  for (const input of [
    null,
    undefined,
    '',
    'nope',
    42,
    [],
    [1, 2],
    true,
    NaN,
  ]) {
    assert.deepEqual(validateThemeConfig(input), {});
  }
});

test('the read side leaves no unknown key in what it returns', () => {
  assert.deepEqual(validateThemeConfig({ nope: 1, alsoNope: { a: 2 } }), {});
});

test('a real config carries a version marker', () => {
  const out = validateThemeConfig({ surfaces: { radius: 'round' } });
  assert.equal(out.version, THEME_CONFIG_VERSION);
});

test('surface enums are clamped to known scales', () => {
  assert.equal(
    validateThemeConfig({ surfaces: { radius: 'round' } }).surfaces.radius,
    'round',
  );
  assert.equal(
    validateThemeConfig({ surfaces: { radius: 'wat' } }).surfaces.radius,
    'soft',
  );
  assert.equal(
    validateThemeConfig({ surfaces: { shadow: 'none' } }).surfaces.shadow,
    'none',
  );
  assert.equal(
    validateThemeConfig({ surfaces: { shadow: 99 } }).surfaces.shadow,
    'soft',
  );

  // Every scale name resolves to real token values.
  for (const scale of Object.values(RADIUS_SCALES)) {
    assert.equal(Object.keys(scale).length, 3);
  }
  assert.deepEqual(Object.keys(SHADOW_SCALES), ['none', 'soft', 'strong']);
});

test('heading weight is clamped and rounded to the CSS range', () => {
  const w = (v) =>
    validateThemeConfig({ typography: { headingWeight: v } }).typography
      .headingWeight;
  assert.equal(w(700), '700');
  assert.equal(w(740), '700');
  assert.equal(w(760), '800');
  assert.equal(w(5000), '900');
  assert.equal(w(-10), '100');
  // A non-numeric weight is dropped entirely rather than coerced to a default.
  assert.deepEqual(
    validateThemeConfig({ typography: { headingWeight: 'bold' } }),
    {},
  );
});

test('heading transform falls back to none for unknown values', () => {
  assert.equal(
    validateThemeConfig({ typography: { headingTransform: 'uppercase' } })
      .typography.headingTransform,
    'uppercase',
  );
  assert.equal(
    validateThemeConfig({ typography: { headingTransform: 'sideways' } })
      .typography.headingTransform,
    'none',
  );
});

test('text scale falls back to normal for unknown values', () => {
  assert.equal(
    validateThemeConfig({ typography: { textScale: 'compact' } }).typography
      .textScale,
    'compact',
  );
  assert.equal(
    validateThemeConfig({ typography: { textScale: 'enormous' } }).typography
      .textScale,
    'normal',
  );
  // Unset stays unset, so the stylesheet default survives untouched.
  assert.equal(
    validateThemeConfig({ typography: { headingWeight: 400 } }).typography
      .textScale,
    undefined,
  );
});

test('cssVarOverrides accepts only --t- tokens', () => {
  const out = validateThemeConfig({
    cssVarOverrides: {
      '--t-color-accent': '#ff0000',
      '--x-evil': 'red',
      color: 'red',
      '--t-ui-panel-bg': '#000',
      '--t-BAD KEY': 'x',
    },
  });

  assert.deepEqual(out.cssVarOverrides, { '--t-color-accent': '#ff0000' });
});

test('cssVarOverrides rejects --t-ui-* so a theme cannot restyle the app chrome', () => {
  const out = validateThemeConfig({
    cssVarOverrides: { '--t-ui-sidebar-bg': '#000000' },
  });
  assert.equal(out.cssVarOverrides, undefined);
  assert.deepEqual(out, {});
});

test('an override value cannot escape its declaration', () => {
  const out = validateThemeConfig({
    cssVarOverrides: { '--t-color-accent': 'red;}html{display:none' },
  });
  const value = out.cssVarOverrides['--t-color-accent'];
  assert.ok(!value.includes(';'));
  assert.ok(!value.includes('{'));
  assert.ok(!value.includes('}'));
});

test('lock modes are clamped to open/locked', () => {
  const out = validateThemeConfig({
    locks: { background: 'locked', logo: 'nonsense', notALock: 'locked' },
  });
  assert.equal(out.locks.background, 'locked');
  assert.equal(out.locks.logo, 'open');
  assert.equal(out.locks.notALock, undefined);
});

test('only properties with a per-slide control are lockable', () => {
  // `imageRadius` and `shadow` were in the vocabulary before anything enforced
  // locks, but no slide type offers a per-slide radius or shadow, so a switch
  // for them would have done nothing.
  assert.deepEqual(LOCKABLE_PROPERTIES, ['background', 'logo']);

  const out = validateThemeConfig({
    locks: { background: 'locked', imageRadius: 'locked', shadow: 'locked' },
  });
  assert.deepEqual(out.locks, { background: 'locked' });
});

test('slideBackgrounds go through the same guard as file themes', () => {
  const out = validateThemeConfig({
    slideBackgrounds: [
      { id: 'calm', label: 'Calm', value: '#e8f0ee' },
      { id: 'lime', label: 'Reserved', value: '#000' },
      { id: 'BAD ID', label: 'Bad', value: '#000' },
      { id: 'inject', label: 'Inject', value: 'red;}body{x:1' },
    ],
  });

  assert.deepEqual(
    out.slideBackgrounds.map((b) => b.id),
    ['calm'],
  );
});

test('backgroundPresets drop empty and non-string entries', () => {
  const out = validateThemeConfig({
    backgroundPresets: ['/a.jpg', '', '  ', 42, null, '/b.jpg'],
  });
  assert.deepEqual(out.backgroundPresets, ['/a.jpg', '/b.jpg']);
});

test('gradient normalizes to a boolean', () => {
  assert.deepEqual(
    validateThemeConfig({ gradient: { enabled: 'yes' } }).gradient,
    {
      enabled: true,
    },
  );
  assert.deepEqual(validateThemeConfig({ gradient: {} }).gradient, {
    enabled: false,
  });
});

test('logo variants keep only the four known slots', () => {
  const out = validateThemeConfig({
    logos: {
      dark: '/d.svg',
      light: '/l.svg',
      sideways: '/s.svg',
      darkSmall: '',
    },
  });
  assert.deepEqual(out.logos, { dark: '/d.svg', light: '/l.svg' });
});

test('slideTypes are dropped when both lists are empty', () => {
  assert.equal(
    validateThemeConfig({ slideTypes: { include: [], exclude: [] } })
      .slideTypes,
    undefined,
  );
  assert.deepEqual(
    validateThemeConfig({ slideTypes: { exclude: ['quote-slide', ''] } })
      .slideTypes,
    { include: [], exclude: ['quote-slide'] },
  );
});

test('validation is idempotent — a validated config revalidates unchanged', () => {
  const once = validateThemeConfig({
    surfaces: { radius: 'round', shadow: 'strong' },
    typography: { headingTransform: 'uppercase', headingWeight: 600 },
    slideBackgrounds: [{ id: 'calm', label: 'Calm', value: '#e8f0ee' }],
    backgroundPresets: ['/a.jpg'],
    gradient: { enabled: true },
    slideTypes: { exclude: ['quote-slide'] },
    defaultTitleSlide: 'custom-title',
    locks: { background: 'locked' },
    cssVarOverrides: { '--t-color-accent': '#ff0000' },
  });

  assert.deepEqual(validateThemeConfig(once), once);
});

test('validateThemeConfig whitelists titleLayout and drops unknown values', () => {
  assert.equal(
    validateThemeConfig({ titleLayout: 'center' }).titleLayout,
    'center',
  );
  assert.equal(validateThemeConfig({ titleLayout: 'top' }).titleLayout, 'top');
  // Unknown token is dropped entirely (normalize supplies the default later).
  assert.ok(
    !('titleLayout' in validateThemeConfig({ titleLayout: 'diagonal' })),
  );
});

// ============================================================
// Write gate: an unknown field is refused by name (D209)
// ============================================================

test('checkThemeConfig refuses each unknown field with its path', () => {
  const cases = [
    [{ nope: 1 }, 'config.nope'],
    [{ logos: { logoAlt: 'x' } }, 'config.logos.logoAlt'],
    [{ surfaces: { radius: 'soft', blur: 2 } }, 'config.surfaces.blur'],
    [{ typography: { size: 'big' } }, 'config.typography.size'],
    [{ gradient: { enabled: true, angle: 45 } }, 'config.gradient.angle'],
    [{ slideTypes: { hidden: ['quote'] } }, 'config.slideTypes.hidden'],
    [{ locks: { wallpaper: 'locked' } }, 'config.locks.wallpaper'],
    [{ backgroundLabels: { dark: 'Night' } }, 'config.backgroundLabels.dark'],
    [
      { backgroundLabels: { lime: { en: 'Paper', nl: 'Papier' } } },
      'config.backgroundLabels.lime',
      'invalid_value',
    ],
    [
      { slideBackgrounds: [{ id: 'calm', value: '#000', swatch: '#111' }] },
      'config.slideBackgrounds.0.swatch',
    ],
    [
      { cssVarOverrides: { '--t-ui-sidebar-bg': '#000' } },
      'config.cssVarOverrides.--t-ui-sidebar-bg',
    ],
    [{ cssVarOverrides: { color: 'red' } }, 'config.cssVarOverrides.color'],
    // The file-theme spellings a record does not carry (D208).
    [{ hiddenSlideTypes: ['quote'] }, 'config.hiddenSlideTypes'],
    [{ textSwatches: [] }, 'config.textSwatches'],
    [{ sampleEmbedUrl: 'https://example.com' }, 'config.sampleEmbedUrl'],
    [{ embedFonts: [] }, 'config.embedFonts'],
  ];
  for (const [input, path, code = 'unknown_field'] of cases) {
    assert.deepEqual(checkThemeConfig(input), { ok: false, path, code }, path);
  }
  assert.deepEqual(checkThemeConfig('nope'), {
    ok: false,
    path: 'config',
    code: 'invalid_value',
  });
});

test('checkThemeConfig passes a known config through the normalizer', () => {
  assert.deepEqual(checkThemeConfig(undefined), { ok: true, config: {} });
  const out = checkThemeConfig({
    version: 1,
    logos: { alt: 'Acme', payoff: '/uploads/p.png', dark: '/uploads/d.svg' },
    backgroundLabels: { lime: 'Paper' },
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.config.logos, {
    alt: 'Acme',
    payoff: '/uploads/p.png',
    dark: '/uploads/d.svg',
  });
});

test('a cssVarOverrides value may be as long as a layered gradient', () => {
  const long = `linear-gradient(${'#000000, '.repeat(150)}#ffffff)`;
  assert.ok(long.length > 540 && long.length <= CSS_VAR_OVERRIDE_MAX);
  const out = validateThemeConfig({
    cssVarOverrides: { '--t-slide-gradient-bg': long },
  });
  assert.equal(out.cssVarOverrides['--t-slide-gradient-bg'], long);
});

// ============================================================
// Colors
// ============================================================

test('validateThemeColors defaults the four roles', () => {
  assert.deepEqual(validateThemeColors(undefined), {
    ok: true,
    colors: { ...DEFAULT_THEME_COLORS },
  });
  assert.deepEqual(validateThemeColors({ primary: '#123456' }).colors, {
    ...DEFAULT_THEME_COLORS,
    primary: '#123456',
  });
});

test('validateThemeColors keeps the optional fields', () => {
  const colors = {
    primary: '#123456',
    background: '#ffffff',
    textLight: '#ffffff',
    textDark: '#111111',
    brand: ['#111111'],
    chart: Array(8).fill('#222222'),
    accentOnDark: '#abc',
    textMuted: 'rgba(17, 17, 17, 0.6)',
    backgrounds: { lime: '#ffffff', dark: '#000000' },
  };
  assert.deepEqual(validateThemeColors(colors), { ok: true, colors });
});

test('validateThemeColors refuses an unknown or invalid field by name', () => {
  const base = { primary: '#123456' };
  const unknown = 'unknown_field';
  const invalid = 'invalid_value';
  const cases = [
    [{ ...base, primary: 'blue' }, 'colors.primary', invalid],
    [{ ...base, accent: '#ffffff' }, 'colors.accent', unknown],
    [{ ...base, brand: [] }, 'colors.brand', invalid],
    [{ ...base, brand: Array(9).fill('#000000') }, 'colors.brand', invalid],
    [{ ...base, brand: ['red'] }, 'colors.brand', invalid],
    [{ ...base, chart: Array(7).fill('#000000') }, 'colors.chart', invalid],
    [
      { ...base, accentOnDark: 'rgba(0, 0, 0, 1)' },
      'colors.accentOnDark',
      invalid,
    ],
    [
      { ...base, textMuted: 'color-mix(in srgb, red, blue)' },
      'colors.textMuted',
      invalid,
    ],
    [
      { ...base, backgrounds: { calm: '#000000' } },
      'colors.backgrounds.calm',
      unknown,
    ],
    [{ ...base, backgrounds: { mist: 'grey' } }, 'colors.backgrounds', invalid],
  ];
  for (const [input, path, code] of cases) {
    assert.deepEqual(
      validateThemeColors(input),
      { ok: false, path, code },
      path,
    );
  }
  assert.deepEqual(validateThemeColors([]), {
    ok: false,
    path: 'colors',
    code: invalid,
  });
});
