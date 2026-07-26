/**
 * Tests for the contrast judgement layer.
 *
 * `shared/contrast.js` exists because the repo had one ratio formula written
 * twice (`getContrastRatio`, and a private `contrast(l1, l2)` inside the
 * background-image sampler) and two unexplained thresholds (3.0 in the sampler,
 * nothing in the theme editor). These tests pin the single implementation, the
 * shared threshold tables, and the vendored APCA constants — the last of which
 * are worth pinning hardest, since a typo in one of them produces plausible
 * numbers rather than an error.
 *
 * Run with: node --test tests/contrast.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getContrastRatio,
  contrastRatioFromLuminance,
  getRelativeLuminance,
  hexToRgb,
} from '../shared/color-utils.js';
import {
  assessContrast,
  getApcaLc,
  WCAG_THRESHOLDS,
  APCA_THRESHOLDS,
} from '../shared/contrast.js';

test('contrastRatioFromLuminance backs getContrastRatio exactly', () => {
  // Not "roughly agrees" — the hex entry point must route through the
  // luminance one, or the duplicate formula is back by another name.
  for (const [a, b] of [
    ['#000000', '#ffffff'],
    ['#38bdf8', '#1c1917'],
    ['#ea580c', '#ffffff'],
    ['#7c3aed', '#a78bfa'],
  ]) {
    const viaHex = getContrastRatio(a, b);
    const viaLuminance = contrastRatioFromLuminance(
      getRelativeLuminance(hexToRgb(a)),
      getRelativeLuminance(hexToRgb(b))
    );
    assert.equal(viaHex, viaLuminance, `${a} vs ${b}`);
  }
});

test('getContrastRatio is order-independent and clamps unparseable input', () => {
  assert.equal(getContrastRatio('#000000', '#ffffff'), 21);
  assert.equal(
    getContrastRatio('#38bdf8', '#1c1917'),
    getContrastRatio('#1c1917', '#38bdf8')
  );
  assert.equal(getContrastRatio('nonsense', '#ffffff'), 1);
});

test('APCA reproduces its published anchor values', () => {
  // Black on white and white on black are the two values every APCA
  // implementation is checked against. If the vendored constants drift, these
  // move before anything else does.
  assert.equal(Math.round(getApcaLc('#000000', '#ffffff') * 10) / 10, 106);
  assert.equal(Math.round(getApcaLc('#ffffff', '#000000') * 10) / 10, -107.9);
});

test('APCA is polarity-aware where the WCAG ratio is not', () => {
  // Same two colours, swapped roles: WCAG returns one number, APCA returns two
  // different magnitudes. That asymmetry is the whole reason APCA is here.
  const ratioA = getContrastRatio('#ffffff', '#1c1917');
  const ratioB = getContrastRatio('#1c1917', '#ffffff');
  assert.equal(ratioA, ratioB);

  const lcDarkOnLight = getApcaLc('#1c1917', '#ffffff');
  const lcLightOnDark = getApcaLc('#ffffff', '#1c1917');
  assert.ok(lcDarkOnLight > 0, 'dark text on light ground reads positive');
  assert.ok(lcLightOnDark < 0, 'light text on dark ground reads negative');
  assert.notEqual(
    Math.abs(lcDarkOnLight).toFixed(4),
    Math.abs(lcLightOnDark).toFixed(4)
  );
});

test('APCA returns 0 for identical colours and unparseable input', () => {
  assert.equal(getApcaLc('#7c3aed', '#7c3aed'), 0);
  assert.equal(getApcaLc('nonsense', '#ffffff'), 0);
  assert.equal(getApcaLc('#ffffff', null), 0);
});

test('assessContrast applies the size-aware WCAG bar', () => {
  // playful's accent: 4.40:1 against its dark pole. Passes as large text,
  // fails as body text — the exact pair that motivated a size parameter.
  const large = assessContrast('#431407', '#ea580c', { size: 'large' });
  const body = assessContrast('#431407', '#ea580c', { size: 'body' });

  assert.equal(large.ratio.toFixed(2), '4.40');
  assert.equal(body.ratio.toFixed(2), '4.40');
  assert.equal(large.level, 'aa');
  assert.equal(large.passes, true);
  assert.equal(body.level, 'fail');
  assert.equal(body.passes, false);
});

test('assessContrast reports AAA only above the AAA bar for that size', () => {
  // midnight's accent against its dark pole: 8.16:1 clears AAA either way.
  const result = assessContrast('#1c1917', '#38bdf8', { size: 'body' });
  assert.ok(result.ratio > WCAG_THRESHOLDS.body.aaa);
  assert.equal(result.level, 'aaa');

  // A pair between the AA and AAA body bars stays at 'aa'.
  const mid = assessContrast('#ffffff', '#7c3aed', { size: 'body' });
  assert.ok(mid.ratio >= WCAG_THRESHOLDS.body.aa);
  assert.ok(mid.ratio < WCAG_THRESHOLDS.body.aaa);
  assert.equal(mid.level, 'aa');
});

test('assessContrast defaults to the body bar and normalizes junk sizes', () => {
  const explicit = assessContrast('#431407', '#ea580c', { size: 'body' });
  assert.deepEqual(assessContrast('#431407', '#ea580c'), explicit);
  assert.deepEqual(assessContrast('#431407', '#ea580c', {}), explicit);
  assert.deepEqual(
    assessContrast('#431407', '#ea580c', { size: 'enormous' }),
    explicit
  );
});

test('assessContrast surfaces APCA disagreement rather than hiding it', () => {
  const result = assessContrast('#1c1917', '#38bdf8', { size: 'body' });
  assert.equal(typeof result.apcaLc, 'number');
  assert.equal(typeof result.apcaPasses, 'boolean');
  assert.equal(result.disagree, result.passes !== result.apcaPasses);

  // The APCA verdict is judged on absolute Lc against the same size bucket.
  assert.equal(
    result.apcaPasses,
    Math.abs(result.apcaLc) >= APCA_THRESHOLDS.body
  );
});

test('threshold tables carry the numbers that used to be scattered literals', () => {
  // bg-contrast.js reads large.aa for its per-pixel target; it used to be a
  // bare `3.0` with only a comment explaining itself.
  assert.equal(WCAG_THRESHOLDS.large.aa, 3);
  assert.equal(WCAG_THRESHOLDS.large.aaa, 4.5);
  assert.equal(WCAG_THRESHOLDS.body.aa, 4.5);
  assert.equal(WCAG_THRESHOLDS.body.aaa, 7);
  assert.equal(APCA_THRESHOLDS.large, 60);
  assert.equal(APCA_THRESHOLDS.body, 75);
});
