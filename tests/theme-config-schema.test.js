/**
 * Tests for the rich theme config schema.
 *
 * `validateThemeConfig` guards a jsonb column that reaches the CSS of every
 * slide, so it is total by design: junk in yields `{}` out, unknown keys are
 * dropped and out-of-range enums fall back rather than throwing. These tests
 * pin that contract, especially the `--t-ui-*` rejection — the app chrome is
 * deliberately theme-independent and a theme must not be able to restyle the
 * application around the slides.
 *
 * Run with: node --test tests/theme-config-schema.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateThemeConfig,
  THEME_CONFIG_VERSION,
  RADIUS_SCALES,
  SHADOW_SCALES,
  LOCKABLE_PROPERTIES,
} from '../shared/theme-config-schema.js';

test('garbage input yields an empty config, never a throw', () => {
  for (const input of [null, undefined, '', 'nope', 42, [], [1, 2], true, NaN]) {
    assert.deepEqual(validateThemeConfig(input), {});
  }
});

test('an object of only unknown keys is treated as unconfigured', () => {
  assert.deepEqual(validateThemeConfig({ nope: 1, alsoNope: { a: 2 } }), {});
});

test('a real config carries a version marker', () => {
  const out = validateThemeConfig({ surfaces: { radius: 'round' } });
  assert.equal(out.version, THEME_CONFIG_VERSION);
});

test('surface enums are clamped to known scales', () => {
  assert.equal(validateThemeConfig({ surfaces: { radius: 'round' } }).surfaces.radius, 'round');
  assert.equal(validateThemeConfig({ surfaces: { radius: 'wat' } }).surfaces.radius, 'soft');
  assert.equal(validateThemeConfig({ surfaces: { shadow: 'none' } }).surfaces.shadow, 'none');
  assert.equal(validateThemeConfig({ surfaces: { shadow: 99 } }).surfaces.shadow, 'soft');

  // Every scale name resolves to real token values.
  for (const scale of Object.values(RADIUS_SCALES)) {
    assert.equal(Object.keys(scale).length, 3);
  }
  assert.deepEqual(Object.keys(SHADOW_SCALES), ['none', 'soft', 'strong']);
});

test('heading weight is clamped and rounded to the CSS range', () => {
  const w = (v) => validateThemeConfig({ typography: { headingWeight: v } }).typography.headingWeight;
  assert.equal(w(700), '700');
  assert.equal(w(740), '700');
  assert.equal(w(760), '800');
  assert.equal(w(5000), '900');
  assert.equal(w(-10), '100');
  // A non-numeric weight is dropped entirely rather than coerced to a default.
  assert.deepEqual(validateThemeConfig({ typography: { headingWeight: 'bold' } }), {});
});

test('heading transform falls back to none for unknown values', () => {
  assert.equal(
    validateThemeConfig({ typography: { headingTransform: 'uppercase' } }).typography.headingTransform,
    'uppercase'
  );
  assert.equal(
    validateThemeConfig({ typography: { headingTransform: 'sideways' } }).typography.headingTransform,
    'none'
  );
});

test('cssVarOverrides accepts only --t- tokens', () => {
  const out = validateThemeConfig({
    cssVarOverrides: {
      '--t-color-accent': '#ff0000',
      '--x-evil': 'red',
      'color': 'red',
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

  assert.deepEqual(out.slideBackgrounds.map((b) => b.id), ['calm']);
});

test('backgroundPresets drop empty and non-string entries', () => {
  const out = validateThemeConfig({
    backgroundPresets: ['/a.jpg', '', '  ', 42, null, '/b.jpg'],
  });
  assert.deepEqual(out.backgroundPresets, ['/a.jpg', '/b.jpg']);
});

test('gradient normalizes to a boolean', () => {
  assert.deepEqual(validateThemeConfig({ gradient: { enabled: 'yes' } }).gradient, {
    enabled: true,
  });
  assert.deepEqual(validateThemeConfig({ gradient: {} }).gradient, { enabled: false });
});

test('logo variants keep only the four known slots', () => {
  const out = validateThemeConfig({
    logos: { dark: '/d.svg', light: '/l.svg', sideways: '/s.svg', darkSmall: '' },
  });
  assert.deepEqual(out.logos, { dark: '/d.svg', light: '/l.svg' });
});

test('slideTypes are dropped when both lists are empty', () => {
  assert.equal(validateThemeConfig({ slideTypes: { include: [], exclude: [] } }).slideTypes, undefined);
  assert.deepEqual(
    validateThemeConfig({ slideTypes: { exclude: ['quote-slide', ''] } }).slideTypes,
    { include: [], exclude: ['quote-slide'] }
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
  assert.equal(validateThemeConfig({ titleLayout: 'center' }).titleLayout, 'center');
  assert.equal(validateThemeConfig({ titleLayout: 'top' }).titleLayout, 'top');
  // Unknown token is dropped entirely (normalize supplies the default later).
  assert.ok(!('titleLayout' in validateThemeConfig({ titleLayout: 'diagonal' })));
})
