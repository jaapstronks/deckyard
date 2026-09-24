/**
 * The ghost-chip placement rule as geometry (B435, D212).
 *
 * `placeGhost()` decides where a "+ <field>" chip stands from the seam its
 * field will occupy: under/over a neighbour in a vertical stack, beside it in
 * a row. It slides along the seam when its spot is taken, goes compact in the
 * margin when the seam has no room, and is pulled back onto the canvas at the
 * edge. The browser half (describeSeam over real layout, every type) is in
 * tests/inline-ghost-placement-all-types.test.js.
 *
 * Run with: node --test tests/inline-ghost-placement.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  placeGhost,
  overlaps,
} from '../client/views/editor/inline-edit/ghost-placement.js';

const CHIP = { width: 100, height: 24 };
const COMPACT = { width: 22, height: 22 };
const BOUNDS = { left: 0, top: 0, width: 800, height: 450 };
const GAP = 6;

/** A heading-sized text field in a column that starts at x=100. */
const TITLE = { left: 100, top: 100, width: 600, height: 40 };

const place = (o) =>
  placeGhost({
    chip: CHIP,
    compact: COMPACT,
    bounds: BOUNDS,
    gap: GAP,
    align: 'start',
    ...o,
  });

test('vertical stack, room under the neighbour: the full chip stands in the seam', () => {
  const r = place({
    direction: 'vertical',
    side: 'after',
    ref: TITLE,
    fields: [TITLE],
  });
  assert.equal(r.compact, false);
  assert.equal(r.collides, false);
  assert.deepEqual(r.rect, { left: 100, top: 146, ...CHIP });
});

test('centred text: the chip is centred on the column, not at its left edge', () => {
  const r = place({
    direction: 'vertical',
    side: 'after',
    ref: TITLE,
    align: 'center',
    fields: [TITLE],
  });
  assert.equal(r.rect.left, 100 + 300 - 50);
});

test('before: the chip stands over the neighbour', () => {
  const r = place({
    direction: 'vertical',
    side: 'before',
    ref: TITLE,
    fields: [TITLE],
  });
  assert.equal(r.rect.top, 100 - GAP - CHIP.height);
});

test('a seam between two filled fields goes compact in the margin, covering neither', () => {
  // The title-slide case: subtitle inserts between title and meta, which sit
  // right under each other.
  const meta = { left: 100, top: 146, width: 600, height: 30 };
  const r = place({
    direction: 'vertical',
    side: 'after',
    ref: TITLE,
    fields: [TITLE, meta],
  });
  assert.equal(r.compact, true);
  assert.equal(r.collides, false);
  assert.ok(r.rect.left + r.rect.width <= TITLE.left, 'in the leading margin');
  assert.ok(!overlaps(r.rect, TITLE) && !overlaps(r.rect, meta));
});

test('a field in the seam is not dodged by sliding: the full chip would read as its label', () => {
  // A short meta line leaves room beside it on the seam, but a subtitle chip
  // there would look like it belongs to the meta.
  const meta = { left: 100, top: 146, width: 200, height: 30 };
  const r = place({
    direction: 'vertical',
    side: 'after',
    ref: TITLE,
    block: { left: 100, top: 100, width: 600, height: 80 },
    fields: [TITLE, meta],
  });
  assert.equal(r.compact, true);
});

test('chips that share a seam slide along it instead of stacking', () => {
  const chips = [];
  const first = place({
    direction: 'vertical',
    side: 'after',
    ref: TITLE,
    fields: [TITLE],
    chips,
  });
  chips.push(first.rect);
  const second = place({
    direction: 'vertical',
    side: 'after',
    ref: TITLE,
    fields: [TITLE],
    chips,
  });
  assert.equal(second.compact, false, 'room along the seam keeps the label');
  assert.equal(second.rect.top, first.rect.top, 'same seam');
  assert.ok(!overlaps(first.rect, second.rect));
});

test('horizontal row: the chip stands beside the neighbour, in the vertical seam', () => {
  const card = { left: 100, top: 200, width: 150, height: 100 };
  const r = place({
    direction: 'horizontal',
    side: 'after',
    ref: card,
    fields: [card],
  });
  assert.equal(r.compact, false);
  assert.equal(r.rect.left, card.left + card.width + GAP);
  assert.equal(r.rect.top, card.top);
});

test('a seam at the canvas edge is pulled back onto the canvas', () => {
  // A caption under a full-bleed image: the seam lies below the slide.
  const image = { left: 0, top: 0, width: 400, height: 450 };
  const r = place({ direction: 'vertical', side: 'after', ref: image });
  assert.equal(r.collides, false);
  assert.ok(r.rect.top + r.rect.height <= BOUNDS.height);
});

test('no room anywhere: the result says so instead of pretending', () => {
  const everything = { ...BOUNDS };
  const r = place({
    direction: 'vertical',
    side: 'after',
    ref: TITLE,
    fields: [everything],
  });
  assert.equal(r.collides, true);
  assert.equal(r.compact, true);
});
