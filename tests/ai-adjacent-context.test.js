import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdjacentContext } from '../server/utils/ai/refine-slides.js';

/**
 * Groups are refined in parallel batches: every group in a batch builds its
 * context BEFORE any of them resolve, so `resolvedTypes` is unset for all of
 * them. These tests pin the behaviour in that state, which is the state most
 * decks are actually in (fewer groups than the batch size of 6).
 */
const groups = [
  { slides: [{ hints: ['has-4-items'] }, { hints: ['has-numeric-data'] }] },
  { slides: [{ hints: ['is-timeline'] }] },
  { slides: [{ hints: ['has-comparison'] }] },
];

test('an unresolved previous group still yields adjacency context', () => {
  // Before the fix this returned '' for every group in the first batch, so the
  // anti-repetition block in the prompt was empty on most decks.
  const context = buildAdjacentContext(groups[1], groups, 1);
  assert.match(context, /Previous slides had these hints/);
  assert.match(context, /has-4-items/);
  assert.match(context, /has-numeric-data/);
});

test('resolved types are preferred over hints when available', () => {
  const resolved = [{ ...groups[0], resolvedTypes: ['kpi-metrics-slide', 'list-slide'] }, groups[1]];
  const context = buildAdjacentContext(resolved[1], resolved, 1);
  assert.match(context, /Previous slides: kpi-metrics-slide, list-slide/);
  assert.doesNotMatch(context, /hints/, 'hints are only the fallback');
});

test('the first group has no previous context', () => {
  assert.doesNotMatch(buildAdjacentContext(groups[0], groups, 0), /Previous slides/);
});

test('duplicate hints are collapsed and the list is bounded', () => {
  const noisy = [
    { slides: Array.from({ length: 12 }, (_, i) => ({ hints: ['has-4-items', `hint-${i}`] })) },
    { slides: [{ hints: [] }] },
  ];
  const line = buildAdjacentContext(noisy[1], noisy, 1);
  const hints = line.replace(/^.*hints: /, '').split(', ');
  assert.ok(hints.length <= 4, 'context stays short enough to be read as a hint, not a spec');
  assert.equal(new Set(hints).size, hints.length, 'no duplicates');
});

test('a previous group with no hints produces no context line', () => {
  const empty = [{ slides: [{ hints: [] }] }, { slides: [{ hints: ['is-timeline'] }] }];
  assert.doesNotMatch(buildAdjacentContext(empty[1], empty, 1), /Previous slides/);
});
