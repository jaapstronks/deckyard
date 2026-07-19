/**
 * Tests for diffAddedSlideIds — the slide.added activity event's core signal.
 *
 * Invariant: a slide counts as "added by this actor" only when the client
 * submitted it, it wasn't already in the deck, and it survived the save. This
 * keeps merge-appended slides from a concurrent editor, and merge-rejected
 * slides, out of the actor's "added N slides" feed line.
 *
 * Run with: node --test tests/slide-added-diff.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { diffAddedSlideIds } from '../server/routes/api/presentations/helpers.js';

const S = (...ids) => ids.map((id) => ({ id }));

describe('diffAddedSlideIds', () => {
  it('returns ids the client added that survived the save', () => {
    const existing = S('a', 'b');
    const submitted = S('a', 'b', 'c', 'd');
    const updated = S('a', 'b', 'c', 'd');
    assert.deepStrictEqual(diffAddedSlideIds(existing, submitted, updated), ['c', 'd']);
  });

  it('is empty when nothing was added (edits only)', () => {
    const existing = S('a', 'b');
    const submitted = S('a', 'b');
    assert.deepStrictEqual(diffAddedSlideIds(existing, submitted, submitted), []);
  });

  it('ignores merge-appended slides the actor did not submit', () => {
    // A concurrent editor's slide 'x' shows up in updated but not in submitted.
    const existing = S('a');
    const submitted = S('a', 'c');
    const updated = S('a', 'c', 'x');
    assert.deepStrictEqual(diffAddedSlideIds(existing, submitted, updated), ['c']);
  });

  it('drops a submitted slide the merge rejected (absent from updated)', () => {
    const existing = S('a');
    const submitted = S('a', 'c', 'd');
    const updated = S('a', 'c'); // 'd' lost to the merge
    assert.deepStrictEqual(diffAddedSlideIds(existing, submitted, updated), ['c']);
  });

  it('dedupes and preserves first-appearance order', () => {
    const existing = S('a');
    const submitted = S('c', 'b', 'c', 'b');
    const updated = S('a', 'b', 'c');
    assert.deepStrictEqual(diffAddedSlideIds(existing, submitted, updated), ['c', 'b']);
  });

  it('tolerates missing/blank ids and non-arrays', () => {
    assert.deepStrictEqual(diffAddedSlideIds(null, null, null), []);
    const submitted = [{ id: '' }, {}, { id: 'good' }];
    assert.deepStrictEqual(diffAddedSlideIds([], submitted, submitted), ['good']);
  });
});
