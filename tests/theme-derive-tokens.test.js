/**
 * Tests for the shared theme token derivation.
 *
 * `deriveThemeTokens` is the single place the four stored colours and two fonts
 * become a `--t-*` token set. It replaced a second copy of the same colour
 * maths that lived in the (now removed) live-preview CSS generator, which could
 * silently drift from what actually rendered.
 *
 * Run with: node --test tests/theme-derive-tokens.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveThemeTokens,
  buildThemeConfig,
} from '../server/utils/theme-builder.js';

const colors = {
  primary: '#7c3aed',
  background: '#fefefe',
  textLight: '#ffffff',
  textDark: '#1f2937',
};
const fonts = { heading: 'Montserrat', body: 'Inter' };

test('deriveThemeTokens falls back to defaults for empty input', () => {
  const { cssVars, brandColors } = deriveThemeTokens();
  assert.equal(cssVars['--t-color-accent'], '#3B82F6');
  assert.equal(cssVars['--t-color-background'], '#ffffff');
  assert.equal(brandColors.length, 4);
});

test('an unparseable primary still yields usable mist and dark surfaces', () => {
  const { cssVars } = deriveThemeTokens({
    colors: { ...colors, primary: 'not-a-colour' },
    fonts,
  });
  assert.equal(cssVars['--t-slide-bg-mist'], '#f8fafc');
  assert.equal(cssVars['--t-slide-bg-dark'], '#111827');
});

test('the dark surface really is dark (quote slides paint white text on it)', () => {
  for (const primary of ['#7c3aed', '#ffff00', '#000000', '#3B82F6']) {
    const { cssVars } = deriveThemeTokens({ colors: { ...colors, primary } });
    const dark = cssVars['--t-slide-bg-dark'];
    const n = parseInt(dark.slice(1), 16);
    const lightness = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
    assert.ok(lightness < 90, `${primary} produced a light "dark" surface: ${dark}`);
  }
});

test('the logo URL token is emitted only when a logo is set', () => {
  assert.equal(deriveThemeTokens({ colors }).cssVars['--t-logo-url'], undefined);
  assert.equal(
    deriveThemeTokens({ colors, logoUrl: '/uploads/logo.svg' }).cssVars['--t-logo-url'],
    "url('/uploads/logo.svg')"
  );
});

test('buildThemeConfig still returns the full theme shape', () => {
  const built = buildThemeConfig({
    id: 'uuid-1',
    slug: 'acme',
    label: 'Acme',
    logoUrl: '/uploads/acme.svg',
    logoSmallUrl: '/uploads/acme-small.svg',
    colors,
    fonts,
  });

  assert.equal(built.id, 'acme');
  assert.equal(built.label, 'Acme');
  assert.equal(built._isCustomTheme, true);
  assert.equal(built._customThemeId, 'uuid-1');
  assert.equal(built.assets.logo, '/uploads/acme.svg');
  assert.equal(built.assets.titleLogo, '/uploads/acme-small.svg');
  assert.equal(built.textColorLight, '#ffffff');
  assert.equal(built.gradient.enabled, false);
  assert.deepEqual(built.slides['card-stack-slide'].colors, built.brandColors);
});
