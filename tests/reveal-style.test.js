/**
 * Build reveal-style resolution (Phase 1 of the build-animations track).
 * Precedence: deck setting → theme default → 'default'. Unknown values are
 * ignored at every layer, so a typo never silently disables builds or picks a
 * style that doesn't exist.
 *
 * Run with: node --test tests/reveal-style.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REVEAL_STYLES,
  DEFAULT_REVEAL_STYLE,
  normalizeRevealStyle,
  resolveRevealStyle,
} from '../shared/reveal-style.js';

test('normalizeRevealStyle accepts known styles, rejects the rest', () => {
  for (const s of REVEAL_STYLES) assert.equal(normalizeRevealStyle(s), s);
  assert.equal(normalizeRevealStyle('typo'), null);
  assert.equal(normalizeRevealStyle(''), null);
  assert.equal(normalizeRevealStyle(undefined), null);
  assert.equal(normalizeRevealStyle(null), null);
});

test('deck setting wins over theme default', () => {
  assert.equal(
    resolveRevealStyle({
      settings: { revealStyle: 'typewriter' },
      theme: { revealStyle: 'default' },
    }),
    'typewriter'
  );
});

test('theme default applies when the deck has no setting', () => {
  assert.equal(
    resolveRevealStyle({ settings: {}, theme: { revealStyle: 'typewriter' } }),
    'typewriter'
  );
});

test('falls back to DEFAULT_REVEAL_STYLE when nothing is set', () => {
  assert.equal(resolveRevealStyle({}), DEFAULT_REVEAL_STYLE);
  assert.equal(resolveRevealStyle(), DEFAULT_REVEAL_STYLE);
  assert.equal(resolveRevealStyle({ settings: {}, theme: {} }), DEFAULT_REVEAL_STYLE);
});

test('an unknown deck value does not mask a valid theme default', () => {
  assert.equal(
    resolveRevealStyle({
      settings: { revealStyle: 'bogus' },
      theme: { revealStyle: 'typewriter' },
    }),
    'typewriter'
  );
});

test('unknown values everywhere resolve to the safe default', () => {
  assert.equal(
    resolveRevealStyle({
      settings: { revealStyle: 'bogus' },
      theme: { revealStyle: 'also-bogus' },
    }),
    DEFAULT_REVEAL_STYLE
  );
});
