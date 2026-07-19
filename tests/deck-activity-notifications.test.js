/**
 * Deck-activity notifications (layer 2): the bundled "someone worked on your
 * deck" bell notification. Tests the pure builders (candidates, copy, payload)
 * and the storage no-DB contract, matching the comment-notification test style.
 *
 * Run with: node --test tests/deck-activity-notifications.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  buildDeckActivityCandidates,
  buildDeckActivityNotificationInput,
  formatDeckActivityTitle,
  deckActivityWindowMinutes,
  DECK_ACTIVITY_TYPE,
} from '../server/services/deck-activity-notifications.js';
import {
  findUnreadDeckActivityNotification,
  refreshDeckActivityNotification,
} from '../server/storage/notifications.js';

describe('buildDeckActivityCandidates', () => {
  it('includes owner, createdBy and collaborators, normalised + deduped', () => {
    const candidates = buildDeckActivityCandidates({
      presentation: { ownerEmail: 'Owner@Example.com', createdBy: 'owner@example.com' },
      actor: { email: 'editor@example.com' },
      collaborators: ['Collab@Example.com', 'collab@example.com', 'other@example.com'],
    });
    assert.deepStrictEqual(candidates.sort(), ['collab@example.com', 'other@example.com', 'owner@example.com']);
  });

  it('never includes the actor (you do not notify yourself)', () => {
    const candidates = buildDeckActivityCandidates({
      presentation: { ownerEmail: 'owner@example.com' },
      actor: { email: 'Owner@Example.com' },
      collaborators: ['owner@example.com'],
    });
    assert.deepStrictEqual(candidates, []);
  });

  it('is empty when there are no members besides the actor', () => {
    const candidates = buildDeckActivityCandidates({
      presentation: {},
      actor: { email: 'editor@example.com' },
      collaborators: [],
    });
    assert.deepStrictEqual(candidates, []);
  });
});

describe('formatDeckActivityTitle', () => {
  it('uses the singular for one slide', () => {
    assert.strictEqual(
      formatDeckActivityTitle('Riley', 1, 'Kickoff'),
      'Riley added a slide to "Kickoff"'
    );
  });

  it('uses the plural + count for many slides', () => {
    assert.strictEqual(
      formatDeckActivityTitle('Riley', 5, 'Kickoff'),
      'Riley added 5 slides to "Kickoff"'
    );
  });

  it('falls back to Someone / Untitled', () => {
    assert.strictEqual(
      formatDeckActivityTitle('', 2, ''),
      'Someone added 2 slides to "Untitled"'
    );
  });
});

describe('buildDeckActivityNotificationInput', () => {
  it('builds a deck_activity payload with count in data and a deck action URL', () => {
    const input = buildDeckActivityNotificationInput({
      presentation: { id: 'deck-1', title: 'Kickoff', ownerEmail: 'owner@example.com' },
      actor: { email: 'Editor@Example.com', name: 'Riley' },
      count: 3,
    });
    assert.strictEqual(input.notificationType, DECK_ACTIVITY_TYPE);
    assert.strictEqual(input.title, 'Riley added 3 slides to "Kickoff"');
    assert.strictEqual(input.presentationId, 'deck-1');
    assert.strictEqual(input.actionUrl, '/app/deck-1');
    assert.strictEqual(input.actorEmail, 'editor@example.com'); // normalised
    assert.strictEqual(input.actorName, 'Riley');
    assert.deepStrictEqual(input.data, {
      presentationTitle: 'Kickoff',
      slideCount: 3,
      kind: 'slide_added',
    });
  });

  it('has no action URL when the deck has no id', () => {
    const input = buildDeckActivityNotificationInput({
      presentation: { title: 'X' },
      actor: { email: 'e@x.com' },
      count: 1,
    });
    assert.strictEqual(input.actionUrl, null);
  });
});

describe('deckActivityWindowMinutes', () => {
  it('defaults to 60 minutes', () => {
    const prev = process.env.DECK_ACTIVITY_NOTIFY_WINDOW_MIN;
    delete process.env.DECK_ACTIVITY_NOTIFY_WINDOW_MIN;
    assert.strictEqual(deckActivityWindowMinutes(), 60);
    if (prev !== undefined) process.env.DECK_ACTIVITY_NOTIFY_WINDOW_MIN = prev;
  });

  it('honours a positive override and ignores garbage', () => {
    const prev = process.env.DECK_ACTIVITY_NOTIFY_WINDOW_MIN;
    process.env.DECK_ACTIVITY_NOTIFY_WINDOW_MIN = '30';
    assert.strictEqual(deckActivityWindowMinutes(), 30);
    process.env.DECK_ACTIVITY_NOTIFY_WINDOW_MIN = 'nonsense';
    assert.strictEqual(deckActivityWindowMinutes(), 60);
    if (prev === undefined) delete process.env.DECK_ACTIVITY_NOTIFY_WINDOW_MIN;
    else process.env.DECK_ACTIVITY_NOTIFY_WINDOW_MIN = prev;
  });
});

describe('deck-activity storage (no-DB contract)', () => {
  it('findUnreadDeckActivityNotification returns null without input or DB', async () => {
    assert.strictEqual(await findUnreadDeckActivityNotification('', 'deck', 'a@x.com', undefined, {}), null);
    // Valid params but no database configured in the test env: safe null.
    assert.strictEqual(
      await findUnreadDeckActivityNotification('u@x.com', 'deck', 'a@x.com', undefined, {}),
      null
    );
  });

  it('refreshDeckActivityNotification reports invalid/unavailable without a database', async () => {
    const bad = await refreshDeckActivityNotification('', 'u@x.com', {}, {});
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.reason, 'invalid_params');
    const res = await refreshDeckActivityNotification('n1', 'u@x.com', { title: 'x' }, {});
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'unavailable');
  });
});
