/**
 * `insertAfterAnchor()` places a slide in its anchor's group (D325, B429).
 * The image import inserts a run by anchoring each slide on the one before,
 * so a run after a child stays a run of sibling children.
 *
 * Run with: node --test tests/insert-after-anchor.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { insertAfterAnchor } from '../server/services/slides.js';

const deck = () => [
  { id: 'p' },
  { id: 'c1', parentId: 'p' },
  { id: 'c2', parentId: 'p' },
  { id: 't' },
];

test('after a child the slide joins its group', () => {
  const slides = deck();
  const slide = { id: 'new' };
  assert.equal(insertAfterAnchor(slides, slide, 1), 2);
  assert.equal(slide.parentId, 'p');
  assert.deepEqual(
    slides.map((s) => s.id),
    ['p', 'c1', 'new', 'c2', 't'],
  );
});

test('after a top-level slide, even a parent, the slide stays top level', () => {
  const slides = deck();
  const slide = { id: 'new' };
  assert.equal(insertAfterAnchor(slides, slide, 0), 1);
  assert.equal(slide.parentId, undefined);
});

test('a run anchored slide by slide stays one run of sibling children', () => {
  const slides = deck();
  const run = [{ id: 'a' }, { id: 'b' }];
  let anchor = 2;
  for (const slide of run) anchor = insertAfterAnchor(slides, slide, anchor);
  assert.deepEqual(
    run.map((s) => s.parentId),
    ['p', 'p'],
  );
  assert.deepEqual(
    slides.map((s) => s.id),
    ['p', 'c1', 'c2', 'a', 'b', 't'],
  );
});
