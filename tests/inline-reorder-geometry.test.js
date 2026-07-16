import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gapCandidates,
  computeDrop,
  resolveMove,
} from '../client/views/editor/inline-edit/reorder-geometry.js';

/** Three cards side by side: [0..100] [120..220] [240..340], all at y 50..150. */
const ROW = [
  { left: 0, top: 50, width: 100, height: 100 },
  { left: 120, top: 50, width: 100, height: 100 },
  { left: 240, top: 50, width: 100, height: 100 },
];

/** Three cards stacked: y [0..80] [100..180] [200..280], all at x 30..330. */
const STACK = [
  { left: 30, top: 0, width: 300, height: 80 },
  { left: 30, top: 100, width: 300, height: 80 },
  { left: 30, top: 200, width: 300, height: 80 },
];

/** A wrapping 2x2 grid: two per row. */
const GRID = [
  { left: 0, top: 0, width: 100, height: 100 },
  { left: 120, top: 0, width: 100, height: 100 },
  { left: 0, top: 140, width: 100, height: 100 },
  { left: 120, top: 140, width: 100, height: 100 },
];

test('horizontal row: pointer left of the first card inserts at 0', () => {
  const drop = computeDrop(ROW, { x: -20, y: 100 });
  assert.equal(drop.index, 0);
  assert.equal(drop.line.orientation, 'v');
});

test('horizontal row: pointer in the gap between cards 1 and 2 inserts at 1', () => {
  const drop = computeDrop(ROW, { x: 111, y: 100 });
  assert.equal(drop.index, 1);
});

test('horizontal row: pointer right of the last card appends (index 3)', () => {
  const drop = computeDrop(ROW, { x: 360, y: 100 });
  assert.equal(drop.index, 3);
});

test('vertical stack: pointer above the first item inserts at 0 with a horizontal line', () => {
  const drop = computeDrop(STACK, { x: 180, y: -10 });
  assert.equal(drop.index, 0);
  assert.equal(drop.line.orientation, 'h');
});

test('vertical stack: pointer between items 2 and 3 inserts at 2', () => {
  const drop = computeDrop(STACK, { x: 180, y: 190 });
  assert.equal(drop.index, 2);
});

test('vertical stack: pointer below the last item appends', () => {
  const drop = computeDrop(STACK, { x: 180, y: 300 });
  assert.equal(drop.index, 3);
});

test('grid row-break: end of row 1 and start of row 2 are the same gap (index 2)', () => {
  const afterRow1 = computeDrop(GRID, { x: 230, y: 50 });
  const beforeRow2 = computeDrop(GRID, { x: -10, y: 190 });
  assert.equal(afterRow1.index, 2);
  assert.equal(beforeRow2.index, 2);
});

test('gapCandidates covers every insertion index from 0 to length', () => {
  for (const rects of [ROW, STACK, GRID]) {
    const indexes = new Set(gapCandidates(rects).map((c) => c.index));
    for (let g = 0; g <= rects.length; g += 1) {
      assert.ok(indexes.has(g), `missing gap ${g}`);
    }
  }
});

test('indicator line hugs the chosen edge', () => {
  // Between ROW cards 0 and 1 there are two candidates for gap 1: the right
  // edge of card 0 (x=100) and the left edge of card 1 (x=120). A pointer at
  // x=105 snaps to the former.
  const drop = computeDrop(ROW, { x: 105, y: 100 });
  assert.equal(drop.index, 1);
  assert.equal(drop.line.x, 100);
  assert.equal(drop.line.y, 50);
  assert.equal(drop.line.length, 100);
});

test('resolveMove maps insertion gaps to array target indexes', () => {
  assert.equal(resolveMove(0, 3), 2); // drag first card past the last two
  assert.equal(resolveMove(2, 0), 0); // drag last card to the front
  assert.equal(resolveMove(1, 1), 1); // gap directly before itself: no-op
  assert.equal(resolveMove(1, 2), 1); // gap directly after itself: no-op
});
