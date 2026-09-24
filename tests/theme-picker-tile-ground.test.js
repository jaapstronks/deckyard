/**
 * B431: the Home theme tile shows the ground a new deck in that theme starts
 * on, not a ground of its own.
 *
 * The tile used to build its sample title slide with `background: 'lime'`
 * hard-coded. A fork theme that neither uses nor colours `lime` (Dreamkit:
 * `slideBackgrounds` canvas/paper/ink/blue, `defaultBackground: "canvas"`)
 * then rendered on the `#e2fe52` fallback, a yellow card that has nothing to do
 * with the theme. The tile now composes its sample through `newSlide()`, the
 * same composition as a new deck's first slide, so these pin that route:
 *
 *   1. A theme without `lime` that declares `defaultBackground` shows that
 *      ground.
 *   2. A theme that declares none shows the type's own default, the same as
 *      its first slide would.
 *   3. The tile's scroller leaves room for the focus ring on every side, also
 *      when a tile is snapped against its edge.
 *
 * Run with: node --test tests/theme-picker-tile-ground.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { themePreviewSlide } from '../client/views/list/theme-picker-row.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { newSlide } from '../shared/slide-types/presentation.js';

// Dreamkit's shape, trimmed to what decides the ground.
const themeWithoutLime = {
  id: 'forkish',
  label: 'Forkish',
  slideBackgrounds: [
    { id: 'canvas', label: 'Canvas', value: '#ffffff' },
    { id: 'ink', label: 'Ink', value: '#0a0e1a' },
  ],
  defaultBackground: 'canvas',
};

test('a theme without lime shows its own defaultBackground', () => {
  const slide = themePreviewSlide(themeWithoutLime, SLIDE_TYPES);
  assert.equal(slide.type, 'title-slide');
  assert.equal(slide.content.background, 'canvas');
  assert.equal(slide.content.title, 'Forkish');
});

test('the tile shows the same ground as the first slide of a new deck', () => {
  for (const theme of [themeWithoutLime, { id: 'plain', label: 'Plain' }]) {
    const tile = themePreviewSlide(theme, SLIDE_TYPES);
    const first = newSlide({
      type: 'title-slide',
      theme,
      slideTypes: SLIDE_TYPES,
    });
    assert.equal(tile.content.background, first.content.background, theme.id);
  }
});

test('a title type the type map does not know is refused, not guessed', () => {
  assert.throws(() =>
    themePreviewSlide(
      { id: 'x', label: 'X', defaultTitleSlide: 'no-such-title-slide' },
      SLIDE_TYPES,
    ),
  );
});

test('the tile scroller holds the focus ring on every side', () => {
  const css = readFileSync(
    new URL(
      '../client/styles/base/04-editor-and-misc/97-theme-picker.css',
      import.meta.url,
    ),
    'utf8',
  );
  const list = css.match(/\.theme-picker-list \{([^}]*)\}/)?.[1] || '';
  assert.match(list, /padding: var\(--theme-picker-reach\)/);
  assert.match(list, /scroll-padding-inline: var\(--theme-picker-reach\)/);
});
