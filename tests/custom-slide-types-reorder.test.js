/**
 * Custom slide type ordering.
 *
 * `listCustomSlideTypes` has always ordered by `sort_order`, but nothing ever
 * wrote it: every type sat at 0 and the list silently fell through to its
 * created_at tiebreaker. These cover the write half — the validation rules
 * that decide whether an order is applied at all, and the array move the grid
 * uses to turn a drop into that order.
 *
 * The storage layer needs a database, so the validation that runs before any
 * query is what is exercised here; the happy path is covered end-to-end
 * against a running server.
 *
 * Run with: node --test tests/custom-slide-types-reorder.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { reorderCustomSlideTypes } from '../server/storage/custom-slide-types.js';
import { resolveMove } from '../client/views/editor/inline-edit/reorder-geometry.js';

const CTX = { organizationId: 'org-1' };

describe('reorderCustomSlideTypes input validation', () => {
  it('rejects a missing or empty order', async () => {
    for (const bad of [undefined, null, [], 'a,b', {}]) {
      const res = await reorderCustomSlideTypes(bad, CTX);
      assert.equal(res.ok, false, `accepted ${JSON.stringify(bad)}`);
      assert.equal(res.reason, 'invalid_order');
    }
  });

  it('rejects duplicate ids (a move that listed one type twice)', async () => {
    const res = await reorderCustomSlideTypes(['a', 'b', 'a'], CTX);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid_order');
  });

  it('rejects blank ids', async () => {
    const res = await reorderCustomSlideTypes(['a', '  ', 'b'], CTX);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid_order');
  });
});

describe('drop index to array move', () => {
  // The grid hands `computeDrop` an insertion gap: gap g means "before item g",
  // and gap === length appends. resolveMove turns that into a target index for
  // an item that is itself about to be spliced out.
  const move = (arr, from, gap) => {
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(resolveMove(from, gap), 0, item);
    return next;
  };

  const ABC = ['a', 'b', 'c'];

  it('dragging the first item past the last appends it', () => {
    assert.deepEqual(move(ABC, 0, 3), ['b', 'c', 'a']);
  });

  it('dragging the last item to the front prepends it', () => {
    assert.deepEqual(move(ABC, 2, 0), ['c', 'a', 'b']);
  });

  it('the two gaps around the dragged item are no-ops', () => {
    assert.deepEqual(move(ABC, 1, 1), ABC);
    assert.deepEqual(move(ABC, 1, 2), ABC);
  });

  it('a drop keeps every item exactly once', () => {
    for (let from = 0; from < 3; from += 1) {
      for (let gap = 0; gap <= 3; gap += 1) {
        assert.deepEqual([...move(ABC, from, gap)].sort(), ABC, `from=${from} gap=${gap}`);
      }
    }
  });
});
