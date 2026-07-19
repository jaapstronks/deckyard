/**
 * Tests for the theme token derivation and its preview serializer.
 *
 * `buildThemeConfig` and `generatePreviewCSS` used to hold separate copies of
 * the same colour maths, so the editor's live preview could drift from what
 * actually rendered. Both now go through `deriveThemeTokens`; the drift guard
 * below is what keeps them honest.
 *
 * Run with: node --test tests/theme-preview-css.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveThemeTokens,
  buildThemeConfig,
  generatePreviewCSS,
} from '../server/utils/theme-builder.js';

const colors = {
  primary: '#7c3aed',
  background: '#fefefe',
  textLight: '#ffffff',
  textDark: '#1f2937',
};
const fonts = { heading: 'Montserrat', body: 'Inter' };

/** Parse `--key: value;` pairs out of a generated CSS block. */
function parseDeclarations(css) {
  const out = {};
  for (const [, key, value] of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out[key] = value.trim();
  }
  return out;
}

test('every preview token matches buildThemeConfig for the same input — the drift guard', () => {
  const declared = parseDeclarations(generatePreviewCSS({ colors, fonts }));
  const built = buildThemeConfig({
    id: 'x',
    slug: 'x',
    label: 'X',
    colors,
    fonts,
  }).cssVars;

  assert.ok(Object.keys(declared).length >= 16, 'preview emitted nothing');
  for (const [token, value] of Object.entries(declared)) {
    assert.equal(
      value,
      String(built[token]),
      `${token} differs between preview and build`
    );
  }
});

test('preview emits a .theme-preview block and nothing else', () => {
  const css = generatePreviewCSS({ colors, fonts });
  assert.match(css, /^\/\* Custom Theme Preview CSS \*\/\n\.theme-preview \{/);
  // Exactly one opening and one closing brace: no second rule snuck in.
  assert.equal((css.match(/\{/g) || []).length, 1);
  assert.equal((css.match(/\}/g) || []).length, 1);
});

test('a value carrying CSS punctuation cannot open a new rule', () => {
  // The route rejects these before they reach here, but the serializer is the
  // last line of defence — a managed font name is free text from the database.
  const css = generatePreviewCSS({
    colors: { ...colors, primary: 'red;}body{display:none' },
    fonts,
  });

  // The payload survives as inert text inside one declaration, but the
  // punctuation that would end it and open `body { … }` is gone.
  assert.equal((css.match(/\{/g) || []).length, 1);
  assert.equal((css.match(/\}/g) || []).length, 1);
  assert.doesNotMatch(css, /body\s*\{/);
  assert.ok(!css.includes(';}'), 'a declaration terminator survived');
  assert.equal(css.split('\n').filter((l) => l.includes('red')).length, 6);
});

test('a hostile managed font name is stripped too', () => {
  const css = generatePreviewCSS({
    colors,
    fonts: { heading: 'Inter', body: 'Inter', headingFamilyId: 'f1' },
    managedFonts: [
      { id: 'f1', name: 'Evil;}html{opacity:0', category: 'sans-serif' },
    ],
  });

  assert.equal((css.match(/\{/g) || []).length, 1);
  assert.doesNotMatch(css, /html\s*\{/);
});

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
