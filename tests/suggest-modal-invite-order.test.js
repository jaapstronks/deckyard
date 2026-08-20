/**
 * "Add as second slide" puts the follow-invite second.
 *
 * Adding an interactive slide to a deck without a follow-invite offers three
 * placements; one of them promises the invite position two. Both slides are
 * inserted in that single gesture, and both were anchored behind the same
 * slide — the first one — so the later insert won and the deck came out as
 * `[title, poll, invite]`. The button's own wording was the spec, so the
 * interactive slide moves behind the invite instead.
 *
 * The rule lives in client/views/editor/slide-insert-position.js next to the
 * splice it has to agree with; these tests pin the resulting order.
 *
 * Run with: node --test tests/suggest-modal-invite-order.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  anchorBehindInvite,
  insertSlideAfter,
} from '../client/views/editor/slide-insert-position.js';

/** What the panel does for "Add as second slide", over a plain slides array. */
function addAsSecond(slides, pending, { afterSlideId, parentId = null } = {}) {
  const firstSlideId = slides.length > 0 ? slides[0]?.id : null;
  const invite = { id: 'invite-1', type: 'follow-invite-slide' };
  insertSlideAfter(slides, invite, firstSlideId);
  if (parentId) pending.parentId = parentId;
  insertSlideAfter(
    slides,
    pending,
    anchorBehindInvite({
      afterSlideId,
      firstSlideId,
      inviteSlideId: invite.id,
      parentId,
    }),
  );
  return slides;
}

const ids = (slides) => slides.map((s) => s.id);

describe('"Add as second slide"', () => {
  it('puts the invite second and the interactive slide third', () => {
    const slides = [{ id: 'title', type: 'title-slide' }];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    addAsSecond(slides, poll, { afterSlideId: 'title' });

    assert.deepEqual(ids(slides), ['title', 'invite-1', 'poll-1']);
  });

  it('leaves a later insertion point alone', () => {
    const slides = [
      { id: 'title', type: 'title-slide' },
      { id: 's2', type: 'text-slide' },
      { id: 's3', type: 'text-slide' },
    ];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    addAsSecond(slides, poll, { afterSlideId: 's2' });

    assert.deepEqual(ids(slides), ['title', 'invite-1', 's2', 'poll-1', 's3']);
  });

  it('keeps a nested slide inside its parent group', () => {
    const slides = [
      { id: 'title', type: 'title-slide' },
      { id: 'parent', type: 'section-slide' },
      { id: 'child', type: 'text-slide', parentId: 'parent' },
    ];
    const poll = { id: 'poll-1', type: 'poll-slide' };

    addAsSecond(slides, poll, { afterSlideId: 'parent', parentId: 'parent' });

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
