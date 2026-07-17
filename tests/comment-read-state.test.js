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
import { markThreadsRead } from '../server/storage/presentation-comments.js';

const ME = 'me@example.com';

function thread({ author = 'other@example.com', status = 'open', replies = [] } = {}) {
  return {
    id: 't-1',
    authorEmail: author,
    status,
    createdAt: '2026-07-17T10:00:00Z',
    replies,
  };
}

function reply(author, createdAt) {
  return { authorEmail: author, createdAt };
}

describe('lastMessageAuthor', () => {
  it('is the top-level author when there are no replies', () => {
    assert.strictEqual(lastMessageAuthor(thread()), 'other@example.com');
  });

  it('is the newest reply author when replies exist', () => {
    const t = thread({
      replies: [
        reply(ME, '2026-07-17T11:00:00Z'),
        reply('other@example.com', '2026-07-17T12:00:00Z'),
      ],
    });
    assert.strictEqual(lastMessageAuthor(t), 'other@example.com');
  });

  it('handles unsorted replies defensively', () => {
    const t = thread({
      replies: [
        reply('late@example.com', '2026-07-17T14:00:00Z'),
        reply('early@example.com', '2026-07-17T11:00:00Z'),
      ],
    });
    assert.strictEqual(lastMessageAuthor(t), 'late@example.com');
  });

  it('normalizes casing', () => {
    assert.strictEqual(lastMessageAuthor(thread({ author: 'Other@Example.COM' })), 'other@example.com');
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
    assert.strictEqual(threadWaitsFor(thread({ status: 'resolved' }), ME), false);
  });

  it('dismissed threads wait for nobody', () => {
    assert.strictEqual(threadWaitsFor(thread({ status: 'dismissed' }), ME), false);
  });

  it('is false without a user email (guests)', () => {
    assert.strictEqual(threadWaitsFor(thread(), ''), false);
    assert.strictEqual(threadWaitsFor(thread(), null), false);
  });

  it('matches user email case-insensitively', () => {
    const t = thread({ replies: [reply('ME@Example.com', '2026-07-17T12:00:00Z')] });
    assert.strictEqual(threadWaitsFor(t, ME), false);
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
    assert.deepStrictEqual(collectUnreadThreadIds([{ unreadForUser: true }]), []);
  });
});

describe('markThreadsRead (no-DB contract)', () => {
  const CTX = { actorEmail: 'someone@example.com' };

  it('requires a presentation id', async () => {
    const r = await markThreadsRead('', ['11111111-1111-1111-1111-111111111111'], CTX);
    assert.deepStrictEqual(r, { ok: false, reason: 'invalid_presentation' });
  });

  it('is a cheap no-op without an acting user (guests)', async () => {
    const r = await markThreadsRead('pres-1', ['11111111-1111-1111-1111-111111111111'], {});
    assert.deepStrictEqual(r, { ok: true, marked: 0 });
  });

  it('is a no-op for an empty or non-uuid id list', async () => {
    assert.deepStrictEqual(await markThreadsRead('pres-1', [], CTX), { ok: true, marked: 0 });
    assert.deepStrictEqual(
      await markThreadsRead('pres-1', ['not-a-uuid', 123, null], CTX),
      { ok: true, marked: 0 }
    );
  });

  it('reports unavailable without a database', async () => {
    const r = await markThreadsRead(
      'pres-1',
      ['11111111-1111-1111-1111-111111111111'],
      CTX
    );
    assert.deepStrictEqual(r, { ok: false, reason: 'unavailable' });
  });
});
