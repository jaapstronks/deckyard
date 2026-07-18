import test from 'node:test';
import assert from 'node:assert/strict';

import { selectSlidesForDeck } from '../test-suite/runner/pipeline.js';

const structural = [
  { originalIndex: 0, type: 'chapter-title-slide' },
  { originalIndex: 4, type: 'chapter-title-slide' },
  { originalIndex: 9, type: 'payoff-slide' },
];

test('a full run keeps every structural slide, in deck order', () => {
  const slides = selectSlidesForDeck({
    structuralSlides: structural,
    refinedContentSlides: [
      { originalIndex: 5, type: 'list-slide' },
      { originalIndex: 1, type: 'content-slide' },
    ],
    partial: false,
  });
  assert.deepEqual(slides.map((s) => s.originalIndex), [0, 1, 4, 5, 9]);
});

test('a partial run drops structural slides beyond the refined span', () => {
  // Only the first section was refined, so the later chapter divider and the
  // closing slide would leave holes where the unrefined sections belong.
  const slides = selectSlidesForDeck({
    structuralSlides: structural,
    refinedContentSlides: [
      { originalIndex: 1, type: 'content-slide' },
      { originalIndex: 2, type: 'list-slide' },
    ],
    partial: true,
  });
  assert.deepEqual(slides.map((s) => s.originalIndex), [0, 1, 2]);
});

test('a partial run with no refined slides yields nothing beyond index zero', () => {
  const slides = selectSlidesForDeck({
    structuralSlides: structural,
    refinedContentSlides: [],
    partial: true,
  });
  assert.deepEqual(slides.map((s) => s.originalIndex), [0]);
});
