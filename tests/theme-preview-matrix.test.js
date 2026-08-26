// The two decisions the theme:preview contact sheet makes before it renders
// anything: which backgrounds a type is walked against, and which of the
// theme's variants have a ground flat enough to measure.
//
// Both are cheap to get subtly wrong in a way the sheet cannot show you: a
// hardcoded lime/mist pair silently skips countdown's five extra backgrounds,
// and a ground colour guessed out of a gradient produces a WCAG number that
// looks authoritative and means nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  backgroundsForType,
  contrastReport,
  groundColorOf,
} from '../scripts/theme-preview.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { normalizeTheme } from '../shared/theme-normalize.js';

const theme = normalizeTheme({
  id: 'fixture',
  slideBackgrounds: [
    {
      id: 'calm',
      value: 'radial-gradient(at 20% 10%, #1d3b3b, transparent), #140a26',
      textColor: '#ffffff',
      textColorMuted: 'rgba(255,255,255,0.72)',
    },
    { id: 'paper', value: '#f6f3ec', textColor: '#171512' },
    {
      id: 'shot',
      value: 'url("/custom/assets/bg.jpg") center/cover',
      textColor: '#ffffff',
    },
    { id: 'plain', value: '#cccccc' },
  ],
});

test('a type is walked against the backgrounds it actually declares', () => {
  // The type's own options come first, in declaration order, and the theme's
  // variants extend them. Read from the def rather than hardcoded, so a fork
  // that overrides content-slide does not fail on its own option list.
  const contentSlide = SLIDE_TYPES['content-slide'];
  const declared = contentSlide.fields
    .find((f) => f.key === 'background')
    .options.map((o) => o.value);
  assert.deepEqual(backgroundsForType(contentSlide, theme), [
    ...declared,
    'calm',
    'paper',
    'shot',
    'plain',
  ]);

  // countdown-slide declares seven of its own. A harness assuming lime/mist
  // would render two of the seven and report full coverage.
  const countdown = backgroundsForType(SLIDE_TYPES['countdown-slide'], theme);
  for (const id of ['dark', 'accent', 'brand-1', 'brand-2', 'custom']) {
    assert.ok(countdown.includes(id), `countdown must be walked against ${id}`);
  }

  // A type with no background field renders once, not once per variant.
  assert.deepEqual(backgroundsForType(SLIDE_TYPES['quote-slide'], theme), [
    null,
  ]);
  assert.deepEqual(backgroundsForType(null, theme), [null]);
});

test('groundColorOf finds the layer the text sits on, or admits it cannot', () => {
  assert.equal(groundColorOf('#140a26'), '#140a26');
  assert.equal(groundColorOf('  #fff  '), '#fff');

  // Gradient over a base colour: the bottom layer is the ground, and the
  // commas inside the gradient's own argument list are not layer separators.
  assert.equal(
    groundColorOf('radial-gradient(at 20% 10%, #1d3b3b, transparent), #140a26'),
    '#140a26',
  );

  // Artwork has no single ground — that is a per-pixel question.
  assert.equal(groundColorOf('url("/a.jpg") center/cover'), '');
  assert.equal(groundColorOf('url(/a.jpg), #140a26'), '');
  // A gradient with no colour under it, and anything unparseable.
  assert.equal(groundColorOf('linear-gradient(#fff, #eee)'), '');
  assert.equal(groundColorOf('var(--t-color-background)'), '');
  assert.equal(groundColorOf(''), '');
  assert.equal(groundColorOf(null), '');
});

test('the contrast report measures flat variants and names what it skipped', () => {
  const rows = contrastReport(theme);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  // A variant with no textColor makes no claim about its own readability.
  assert.equal(byId.plain, undefined);

  // Artwork is reported as unmeasured rather than scored.
  assert.equal(byId.shot.skipped, 'artwork');
  assert.deepEqual(byId.shot.pairs, []);

  // White on #140a26 (under the gradient) is comfortably AAA.
  const calmText = byId.calm.pairs.find((p) => p.role === 'text');
  assert.equal(byId.calm.ground, '#140a26');
  assert.ok(
    calmText.ratio > 15,
    `expected a high ratio, got ${calmText.ratio}`,
  );
  assert.equal(calmText.level, 'aaa');

  // An rgba() muted tone is not a number this measurement can take. Scoring it
  // would report 1:1 — a failure the theme does not have.
  const calmMuted = byId.calm.pairs.find((p) => p.role === 'muted');
  assert.equal(calmMuted.skipped, 'non-hex');
  assert.equal(calmMuted.ratio, undefined);

  assert.equal(byId.paper.pairs.length, 1);
  assert.equal(byId.paper.pairs[0].level, 'aaa');
});
