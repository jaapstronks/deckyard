/**
 * Tests for merging a stored theme config over the derived theme.
 *
 * The load-bearing test here is the back-compat one: every `themes` row that
 * predates the `config` column reads as `{}`, and such a theme must build
 * byte-identically to how it built before the column existed. Everything else
 * in this slice is additive; that one guarantee is what makes the migration
 * safe to run on a live install.
 *
 * Run with: node --test tests/theme-builder-config.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThemeConfig } from '../server/utils/theme-builder.js';

const baseRow = () => ({
  id: 'uuid-1',
  slug: 'acme',
  label: 'Acme',
  logoUrl: '/uploads/acme.svg',
  logoSmallUrl: '/uploads/acme-small.svg',
  colors: {
    primary: '#7c3aed',
    background: '#fefefe',
    textLight: '#ffffff',
    textDark: '#1f2937',
  },
  fonts: { heading: 'Montserrat', body: 'Inter' },
});

/**
 * The exact theme a pre-migration row built. Pinned as a fixture rather than
 * recomputed, so a change to the derivation has to be an explicit decision.
 */
const PRE_MIGRATION_CSS_VARS = {
  '--t-color-background': '#fefefe',
  '--t-color-text': '#1f2937',
  '--t-color-text-muted': 'rgba(31, 41, 55, 0.7)',
  '--t-color-accent': '#7c3aed',
  '--t-slide-bg-lime': '#fefefe',
  '--t-slide-bg-mist': '#f7f4fa',
  '--t-slide-bg-dark': '#1f1434',
  '--t-quote-author-color': '#7c3aed',
  '--t-radius': '16px',
  '--t-radius-sm': '12px',
  '--t-radius-lg': '20px',
  '--t-font-heading': "'Montserrat', sans-serif",
  '--t-font-body': "'Inter', sans-serif",
  '--t-font-caption': 'var(--t-font-body)',
  '--t-font-mono':
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  '--t-heading-transform': 'none',
  '--t-heading-weight': '700',
  '--t-icon-card-grid-icon-bg': '#f7f4fa',
  '--t-chart-0': '#7c3aed',
  '--t-chart-1': '#996aea',
  '--t-chart-2': '#b69be5',
  '--t-chart-3': '#c9bae3',
  '--t-chart-4': '#1f2937',
  '--t-chart-5': 'rgba(31, 41, 55, 0.7)',
  '--t-chart-6': '#7c3aed',
  '--t-chart-7': '#f7f4fa',
  '--t-logo-url': "url('/uploads/acme.svg')",
};

test('a row with no config builds exactly as it did before the column existed', () => {
  // Every pre-migration row reads as `{}` — this is the whole back-compat story.
  for (const config of [undefined, null, {}]) {
    const built = buildThemeConfig({ ...baseRow(), config });
    assert.deepEqual(built.cssVars, PRE_MIGRATION_CSS_VARS);
    assert.deepEqual(built.backgroundPresets, []);
    assert.deepEqual(built.gradient, { enabled: false });
    assert.equal(built.defaultTitleSlide, 'title-slide');
    assert.equal(built.slideBackgrounds, undefined);
    assert.equal(built.locks, undefined);
  }
});

test('a malformed config is ignored rather than breaking the theme', () => {
  const built = buildThemeConfig({ ...baseRow(), config: 'not an object' });
  assert.deepEqual(built.cssVars, PRE_MIGRATION_CSS_VARS);
});

test('surface config drives the radius triple and the shadow token', () => {
  const built = buildThemeConfig({
    ...baseRow(),
    config: { surfaces: { radius: 'none', shadow: 'none' } },
  });

  assert.equal(built.cssVars['--t-radius'], '0px');
  assert.equal(built.cssVars['--t-radius-sm'], '0px');
  assert.equal(built.cssVars['--t-radius-lg'], '0px');
  assert.equal(built.cssVars['--t-shadow-opacity'], '0');
});

test('no shadow token is emitted when surfaces are unconfigured', () => {
  // Absent means "leave the stylesheet defaults alone", not "shadow: soft".
  const built = buildThemeConfig({ ...baseRow(), config: {} });
  assert.equal(built.cssVars['--t-shadow-opacity'], undefined);
});

test('typography config overrides the hardcoded heading defaults', () => {
  const built = buildThemeConfig({
    ...baseRow(),
    config: {
      typography: { headingTransform: 'uppercase', headingWeight: 400 },
    },
  });

  assert.equal(built.cssVars['--t-heading-transform'], 'uppercase');
  assert.equal(built.cssVars['--t-heading-weight'], '400');
});

test('slideBackgrounds close the documented DB/file parity gap', () => {
  // DB themes previously had no way to express named background variants at
  // all — the builder emitted no `slideBackgrounds` key.
  const built = buildThemeConfig({
    ...baseRow(),
    config: {
      slideBackgrounds: [
        { id: 'calm', label: 'Calm', value: '#e8f0ee', textColor: '#0b0b0b' },
      ],
    },
  });

  assert.deepEqual(built.slideBackgrounds.map((b) => b.id), ['calm']);
});

test('backgroundPresets, gradient and defaultTitleSlide come from config', () => {
  const built = buildThemeConfig({
    ...baseRow(),
    config: {
      backgroundPresets: ['/custom/a.jpg', '/custom/b.jpg'],
      gradient: { enabled: true },
      defaultTitleSlide: 'acme-title-slide',
      slideTypes: { exclude: ['quote-slide'], include: [] },
    },
  });

  assert.deepEqual(built.backgroundPresets, ['/custom/a.jpg', '/custom/b.jpg']);
  assert.deepEqual(built.gradient, { enabled: true });
  assert.equal(built.defaultTitleSlide, 'acme-title-slide');
  assert.deepEqual(built.slideTypes.exclude, ['quote-slide']);
});

test('logo variants land alongside the existing large/small pair', () => {
  const built = buildThemeConfig({
    ...baseRow(),
    config: { logos: { dark: '/uploads/dark.svg', light: '/uploads/light.svg' } },
  });

  assert.equal(built.assets.dark, '/uploads/dark.svg');
  assert.equal(built.assets.light, '/uploads/light.svg');
  // The originals survive.
  assert.equal(built.assets.logo, '/uploads/acme.svg');
  assert.equal(built.assets.titleLogo, '/uploads/acme-small.svg');
});

test('cssVarOverrides win over everything else in the merge', () => {
  const built = buildThemeConfig({
    ...baseRow(),
    config: {
      surfaces: { radius: 'round' },
      cssVarOverrides: {
        '--t-radius': '4px',
        '--t-color-accent': '#00ff00',
      },
    },
  });

  assert.equal(built.cssVars['--t-radius'], '4px', 'override must beat the radius scale');
  assert.equal(built.cssVars['--t-color-accent'], '#00ff00', 'override must beat the derived colour');
});

test('a --t-ui-* override never reaches the theme', () => {
  const built = buildThemeConfig({
    ...baseRow(),
    config: { cssVarOverrides: { '--t-ui-sidebar-bg': '#000000' } },
  });
  assert.equal(built.cssVars['--t-ui-sidebar-bg'], undefined);
});

test('locks are stored on the theme for later enforcement', () => {
  const built = buildThemeConfig({
    ...baseRow(),
    config: { locks: { background: 'locked' } },
  });
  assert.deepEqual(built.locks, { background: 'locked' });
});
