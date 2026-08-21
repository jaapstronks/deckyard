/**
 * Where the follow-invite suggestion puts both slides.
 *
 * Adding an interactive slide to a deck without a follow-invite offers three
 * placements, and two slides land in that single gesture. Two bugs came out of
 * that:
 *
 * - "Add as second slide" promises the invite position two, but both slides
 *   were anchored behind the first one, so the later insert won and the deck
 *   came out as `[title, poll, invite]` (#869).
 * - "Add before this slide" looked the invite up by type after inserting it,
 *   which finds the deck's *first* invite — not the one it just inserted — so
 *   a deck that already carried an invite put the interactive slide behind the
 *   wrong one.
 *
 * The rules live in client/views/editor/slide-insert-position.js next to the
 * splice they have to agree with, and both editor insertion paths (type picker
 * and slide library) route through `followInvitePlacements`. These tests drive
 * that function directly and pin the resulting order.
 *
 * Run with: node --test tests/suggest-modal-invite-order.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  followInvitePlacements,
  insertSlideAfter,
} from '../client/views/editor/slide-insert-position.js';

/**
 * Wire the placements to a plain slides array the way the panel wires them to
 * the deck: `insertInvite` splices a fresh invite in and returns its id,
 * `insertPending` splices the waiting interactive slide in behind the anchor
 * it is handed.
 */
function placements(slides, pending, { afterSlideId, parentId = null } = {}) {
  let n = 0;
  return followInvitePlacements({
    afterSlideId,
    parentId,
    getFirstSlideId: () => (slides.length > 0 ? slides[0]?.id : null),
    insertInvite: (anchorId) => {
      n += 1;
      const invite = { id: `invite-${n}`, type: 'follow-invite-slide' };
      insertSlideAfter(slides, invite, anchorId);
      return invite.id;
    },
    insertPending: (anchorId) => {
      if (parentId) pending.parentId = parentId;
      insertSlideAfter(slides, pending, anchorId);
    },
  });
}

const ids = (slides) => slides.map((s) => s.id);

describe('"Add as second slide"', () => {
  it('puts the invite second and the interactive slide third', () => {
    const slides = [{ id: 'title', type: 'title-slide' }];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    placements(slides, poll, { afterSlideId: 'title' }).onAddAsSecond();

    assert.deepEqual(ids(slides), ['title', 'invite-1', 'poll-1']);
  });

  it('leaves a later insertion point alone', () => {
    const slides = [
      { id: 'title', type: 'title-slide' },
      { id: 's2', type: 'text-slide' },
      { id: 's3', type: 'text-slide' },
    ];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    placements(slides, poll, { afterSlideId: 's2' }).onAddAsSecond();

    assert.deepEqual(ids(slides), ['title', 'invite-1', 's2', 'poll-1', 's3']);
  });

  it('keeps a nested slide inside its parent group', () => {
    const slides = [
      { id: 'title', type: 'title-slide' },
      { id: 'parent', type: 'section-slide' },
      { id: 'child', type: 'text-slide', parentId: 'parent' },
    ];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    placements(slides, poll, {
      afterSlideId: 'parent',
      parentId: 'parent',
    }).onAddAsSecond();

    assert.deepEqual(ids(slides), [
      'title',
      'invite-1',
      'parent',
      'poll-1',
      'child',
    ]);
    assert.equal(poll.parentId, 'parent');
  });
});

describe('"Add before this slide"', () => {
  it('puts the interactive slide behind the invite it just inserted', () => {
    const slides = [
      { id: 'title', type: 'title-slide' },
      { id: 's2', type: 'text-slide' },
    ];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    placements(slides, poll, { afterSlideId: 's2' }).onAddBeforeCurrent();

    assert.deepEqual(ids(slides), ['title', 's2', 'invite-1', 'poll-1']);
  });

  it('ignores an invite that was already in the deck', () => {
    // The deck already carries an invite up front; looking the new one up by
    // type used to find that one and strand the poll behind it.
    const slides = [
      { id: 'title', type: 'title-slide' },
      { id: 'old-invite', type: 'follow-invite-slide' },
      { id: 's3', type: 'text-slide' },
      { id: 's4', type: 'text-slide' },
    ];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    placements(slides, poll, { afterSlideId: 's4' }).onAddBeforeCurrent();

    assert.deepEqual(ids(slides), [
      'title',
      'old-invite',
      's3',
      's4',
      'invite-1',
      'poll-1',
    ]);
  });

  it('carries the parent through for a nested slide', () => {
    const slides = [
      { id: 'title', type: 'title-slide' },
      { id: 'parent', type: 'section-slide' },
      { id: 'child', type: 'text-slide', parentId: 'parent' },
    ];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    placements(slides, poll, {
      afterSlideId: 'child',
      parentId: 'parent',
    }).onAddBeforeCurrent();

    assert.deepEqual(ids(slides), [
      'title',
      'parent',
      'child',
      'invite-1',
      'poll-1',
    ]);
    assert.equal(poll.parentId, 'parent');
  });
});

describe('"Skip for now"', () => {
  it('inserts the interactive slide alone, at its own anchor', () => {
    const slides = [
      { id: 'title', type: 'title-slide' },
      { id: 's2', type: 'text-slide' },
    ];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    placements(slides, poll, { afterSlideId: 'title' }).onSkip();

    assert.deepEqual(ids(slides), ['title', 'poll-1', 's2']);
  });
});

describe('insertSlideAfter', () => {
  it('inserts at the front for a null anchor', () => {
    const slides = [{ id: 'a' }, { id: 'b' }];
    insertSlideAfter(slides, { id: 'new' }, null);
    assert.deepEqual(ids(slides), ['new', 'a', 'b']);
  });

  it('appends when the anchor is no longer in the deck', () => {
    const slides = [{ id: 'a' }, { id: 'b' }];
    insertSlideAfter(slides, { id: 'new' }, 'gone');
    assert.deepEqual(ids(slides), ['a', 'b', 'new']);
  });
});
