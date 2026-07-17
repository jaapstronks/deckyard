/**
 * Tests for the subscription resolver (phase 4 of the comments &
 * notifications plan): the pure candidate builder + level filter, and the
 * no-DB contracts of the storage layer. DB-backed behaviour (overrides,
 * watcher fan-out, settings defaults) is verified as a local integration
 * step, matching this repo's test boundary.
 *
 * Run with: node --test tests/comment-subscriptions.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  levelAllows,
  buildCandidates,
  REASON_TO_TYPE,
} from '../server/services/comment-subscriptions.js';
import {
  getSubscription,
  setSubscription,
  listSubscriptions,
} from '../server/storage/presentation-subscriptions.js';

const PRES = { id: 'p-1', title: 'Deck', ownerEmail: 'owner@example.com' };

describe('levelAllows', () => {
  it('mentions always deliver, at every level', () => {
    for (const level of ['watching', 'participating', 'mentions_only', 'mute']) {
      assert.strictEqual(levelAllows(level, 'mention'), true, level);
    }
  });

  it('watching delivers everything', () => {
    for (const reason of ['reply', 'participating', 'watching']) {
      assert.strictEqual(levelAllows('watching', reason), true, reason);
    }
  });

  it('participating delivers replies and participation, not watch-only events', () => {
    assert.strictEqual(levelAllows('participating', 'reply'), true);
    assert.strictEqual(levelAllows('participating', 'participating'), true);
    assert.strictEqual(levelAllows('participating', 'watching'), false);
  });

  it('mentions_only and mute silence everything except mentions', () => {
    for (const level of ['mentions_only', 'mute']) {
      assert.strictEqual(levelAllows(level, 'reply'), false, level);
      assert.strictEqual(levelAllows(level, 'participating'), false, level);
      assert.strictEqual(levelAllows(level, 'watching'), false, level);
    }
  });

  it('unknown levels behave as participating', () => {
    assert.strictEqual(levelAllows('bogus', 'reply'), true);
    assert.strictEqual(levelAllows(undefined, 'watching'), false);
  });
});

describe('buildCandidates', () => {
  it('owner and thread participants join as participating', () => {
    const candidates = buildCandidates({
      presentation: PRES,
      comment: { body: 'plain' },
      actor: { email: 'someone@example.com' },
      threadParticipants: ['writer@example.com'],
    });
    assert.strictEqual(candidates.get('owner@example.com'), 'participating');
    assert.strictEqual(candidates.get('writer@example.com'), 'participating');
  });

  it('specificity: mention beats reply beats participating beats watching', () => {
    const candidates = buildCandidates({
      presentation: PRES,
      comment: {
        body: 'x',
        mentions: [{ name: 'O', email: 'owner@example.com' }],
        parentId: 'c-1',
      },
      parentComment: { authorEmail: 'owner@example.com' },
      actor: { email: 'someone@example.com' },
      threadParticipants: ['owner@example.com'],
      watchers: ['owner@example.com', 'watcher@example.com'],
    });
    assert.strictEqual(candidates.get('owner@example.com'), 'mention');
    assert.strictEqual(candidates.get('watcher@example.com'), 'watching');
  });

  it('parent author gets reply when not mentioned', () => {
    const candidates = buildCandidates({
      presentation: PRES,
      comment: { body: 'x', parentId: 'c-1' },
      parentComment: { authorEmail: 'author@example.com' },
      actor: { email: 'someone@example.com' },
    });
    assert.strictEqual(candidates.get('author@example.com'), 'reply');
  });

  it('the actor is never a candidate', () => {
    const candidates = buildCandidates({
      presentation: PRES,
      comment: { body: 'x', mentions: [{ email: 'owner@example.com' }] },
      actor: { email: 'Owner@Example.com' },
      watchers: ['owner@example.com'],
    });
    assert.strictEqual(candidates.size, 0);
  });

  it('createdBy counts as participating next to ownerEmail', () => {
    const candidates = buildCandidates({
      presentation: { ...PRES, createdBy: 'creator@example.com' },
      comment: { body: 'x' },
      actor: { email: 'someone@example.com' },
    });
    assert.strictEqual(candidates.get('creator@example.com'), 'participating');
  });
});

describe('REASON_TO_TYPE', () => {
  it('maps every reason to a notification type', () => {
    assert.deepStrictEqual(REASON_TO_TYPE, {
      mention: 'comment_mention',
      reply: 'comment_reply',
      participating: 'comment_created',
      watching: 'comment_created',
    });
  });
});

describe('presentation-subscriptions storage (no-DB contract)', () => {
  it('getSubscription returns null without input or DB', async () => {
    assert.strictEqual(await getSubscription('', 'a@b.c', {}), null);
    assert.strictEqual(await getSubscription('p-1', '', {}), null);
    assert.strictEqual(await getSubscription('p-1', 'a@b.c', {}), null);
  });

  it('setSubscription validates level', async () => {
    const r = await setSubscription('p-1', 'a@b.c', 'shouting', {});
    assert.deepStrictEqual(r, { ok: false, reason: 'invalid_level' });
  });

  it('setSubscription reports unavailable without a database', async () => {
    const r = await setSubscription('p-1', 'a@b.c', 'mute', {});
    assert.deepStrictEqual(r, { ok: false, reason: 'unavailable' });
  });

  it('listSubscriptions returns an empty map without a database', async () => {
    const map = await listSubscriptions('p-1', {});
    assert.ok(map instanceof Map);
    assert.strictEqual(map.size, 0);
  });
});
