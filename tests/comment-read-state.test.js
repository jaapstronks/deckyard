/**
 * Tests for the per-user comment read-state (phase 2 of the comments &
 * notifications plan).
 *
 * Pure client helpers (`comments-read-state.js`) carry the "waiting for me"
 * heuristic and the unread-id collection; the storage side
 * (`markThreadsRead`) is exercised for its no-DB / no-user contract. The
 * DB-backed behaviour (upsert, unreadForUser annotation in listComments)
 * needs a live Postgres and is verified as a local integration step,
 * matching this repo's test boundary.
 *
 * Run with: node --test tests/comment-read-state.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  lastMessageAuthor,
  threadWaitsFor,
  collectUnreadThreadIds,
} from '../client/views/editor/comments-read-state.js';
import { markThreadsRead } from '../server/storage/presentations/comments.js';

// A comment names its author with `{ id, displayName }` and carries no address
// (D22), so "who spoke last" is an id comparison.
const ME = 'user-me';
const OTHER = 'user-other';

function thread({ author = OTHER, status = 'open', replies = [] } = {}) {
  return {
    id: 't-1',
    author: { id: author, displayName: author },
    status,
    createdAt: '2026-07-17T10:00:00Z',
    replies,
  };
}

function reply(author, createdAt) {
  return { author: { id: author, displayName: author }, createdAt };
}

describe('lastMessageAuthor', () => {
  it('is the top-level author when there are no replies', () => {
    assert.strictEqual(lastMessageAuthor(thread()), OTHER);
  });

  it('is the newest reply author when replies exist', () => {
    const t = thread({
      replies: [
        reply(ME, '2026-07-17T11:00:00Z'),
        reply(OTHER, '2026-07-17T12:00:00Z'),
      ],
    });
    assert.strictEqual(lastMessageAuthor(t), OTHER);
  });

  it('handles unsorted replies defensively', () => {
    const t = thread({
      replies: [
        reply('user-late', '2026-07-17T14:00:00Z'),
        reply('user-early', '2026-07-17T11:00:00Z'),
      ],
    });
    assert.strictEqual(lastMessageAuthor(t), 'user-late');
  });

  it('is empty for an author with no id (a share-link guest)', () => {
    assert.strictEqual(lastMessageAuthor({ id: 't', author: null }), '');
  });
});

describe('threadWaitsFor', () => {
  it('waits for me when someone else spoke last', () => {
    assert.strictEqual(threadWaitsFor(thread(), ME), true);
  });

  it('does not wait for me when I spoke last', () => {
    const t = thread({ replies: [reply(ME, '2026-07-17T12:00:00Z')] });
    assert.strictEqual(threadWaitsFor(t, ME), false);
  });

  it('resolved threads wait for nobody', () => {
    assert.strictEqual(
      threadWaitsFor(thread({ status: 'resolved' }), ME),
      false,
    );
  });

  it('dismissed threads wait for nobody', () => {
    assert.strictEqual(
      threadWaitsFor(thread({ status: 'dismissed' }), ME),
      false,
    );
  });

  it('is false without a user id (guests)', () => {
    assert.strictEqual(threadWaitsFor(thread(), ''), false);
    assert.strictEqual(threadWaitsFor(thread(), null), false);
  });
});

describe('collectUnreadThreadIds', () => {
  it('collects only threads the server flagged unread', () => {
    const threads = [
      { id: 'a', unreadForUser: true },
      { id: 'b', unreadForUser: false },
      { id: 'c' },
      { id: 'd', unreadForUser: true },
    ];
    assert.deepStrictEqual(collectUnreadThreadIds(threads), ['a', 'd']);
  });

  it('tolerates junk input', () => {
    assert.deepStrictEqual(collectUnreadThreadIds(null), []);
    assert.deepStrictEqual(
      collectUnreadThreadIds([{ unreadForUser: true }]),
      [],
    );
  });
});

describe('markThreadsRead (no-DB contract)', () => {
  const CTX = {
    organizationId: '00000000-0000-0000-0000-0000000000aa',
    actorEmail: 'someone@example.com',
  };
  const GUEST = { organizationId: CTX.organizationId };

  it('requires a presentation id', async () => {
    const r = await markThreadsRead(CTX, '', [
      '11111111-1111-1111-1111-111111111111',
    ]);
    assert.deepStrictEqual(r, { ok: false, reason: 'invalid_presentation' });
  });

  it('is a cheap no-op without an acting user (guests)', async () => {
    const r = await markThreadsRead(GUEST, 'pres-1', [
      '11111111-1111-1111-1111-111111111111',
    ]);
    assert.deepStrictEqual(r, { ok: true, marked: 0 });
  });

  it('is a no-op for an empty or non-uuid id list', async () => {
    assert.deepStrictEqual(await markThreadsRead(CTX, 'pres-1', []), {
      ok: true,
      marked: 0,
    });
    assert.deepStrictEqual(
      await markThreadsRead(CTX, 'pres-1', ['not-a-uuid', 123, null]),
      { ok: true, marked: 0 },
    );
  });

  it('reports unavailable without a database', async () => {
    const r = await markThreadsRead(CTX, 'pres-1', [
      '11111111-1111-1111-1111-111111111111',
    ]);
    assert.deepStrictEqual(r, { ok: false, reason: 'unavailable' });
  });
});
