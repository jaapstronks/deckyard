/**
 * Tests for @mentions (phase 3 of the comments & notifications plan):
 * the shared markup parser and the mention-aware notification builder.
 *
 * Run with: node --test tests/comment-mentions.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  parseMentions,
  splitMentionSegments,
  mentionMarkup,
  stripMentionMarkup,
} from '../shared/comment-mentions.js';
import { buildInAppNotificationInputs } from '../server/services/comment-notifications.js';

describe('parseMentions', () => {
  it('parses a single mention', () => {
    assert.deepStrictEqual(
      parseMentions('Hey @[Chris de Vries](user:chris@example.com), kijk even mee'),
      [{ name: 'Chris de Vries', email: 'chris@example.com' }]
    );
  });

  it('parses multiple mentions and dedupes by email (case-insensitive)', () => {
    const body =
      '@[Chris](user:chris@example.com) en @[Sam](user:sam@example.com) en nog eens @[Chris V](user:Chris@Example.com)';
    assert.deepStrictEqual(parseMentions(body), [
      { name: 'Chris', email: 'chris@example.com' },
      { name: 'Sam', email: 'sam@example.com' },
    ]);
  });

  it('ignores plain @email and loose @names', () => {
    assert.deepStrictEqual(parseMentions('mail chris@example.com of @chris'), []);
  });

  it('requires an email-shaped target', () => {
    assert.deepStrictEqual(parseMentions('@[X](user:not-an-email)'), []);
  });

  it('handles empty/nullish bodies', () => {
    assert.deepStrictEqual(parseMentions(''), []);
    assert.deepStrictEqual(parseMentions(null), []);
  });
});

describe('splitMentionSegments', () => {
  it('splits text and mentions in order', () => {
    const segs = splitMentionSegments('Voor @[Chris](user:chris@example.com): zie slide 2');
    assert.deepStrictEqual(segs, [
      { type: 'text', text: 'Voor ' },
      { type: 'mention', name: 'Chris', email: 'chris@example.com' },
      { type: 'text', text: ': zie slide 2' },
    ]);
  });

  it('returns one text segment when there are no mentions', () => {
    assert.deepStrictEqual(splitMentionSegments('gewoon tekst'), [
      { type: 'text', text: 'gewoon tekst' },
    ]);
  });
});

describe('mentionMarkup / stripMentionMarkup', () => {
  it('round-trips through the parser', () => {
    const markup = mentionMarkup({ name: 'Chris de Vries', email: 'chris@example.com' });
    assert.deepStrictEqual(parseMentions(`hi ${markup}!`), [
      { name: 'Chris de Vries', email: 'chris@example.com' },
    ]);
  });

  it('sanitizes brackets out of display names', () => {
    const markup = mentionMarkup({ name: 'X[y]z', email: 'x@example.com' });
    assert.strictEqual(markup, '@[X y z](user:x@example.com)');
    // Still parseable despite the hostile name
    assert.deepStrictEqual(parseMentions(markup), [{ name: 'X y z', email: 'x@example.com' }]);
  });

  it('strips markup to @Name for excerpts', () => {
    assert.strictEqual(
      stripMentionMarkup('Voor @[Chris](user:chris@example.com): fix dit'),
      'Voor @Chris: fix dit'
    );
  });
});

describe('mention notifications (specificity: mention > reply > created)', () => {
  const PRES = { id: 'p-1', title: 'Deck', ownerEmail: 'owner@example.com' };

  it('mentioned non-participant gets comment_mention', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: PRES,
      comment: {
        id: 'c-1',
        body: 'Kijk jij even, @[Sam](user:sam@example.com)?',
        mentions: [{ name: 'Sam', email: 'sam@example.com' }],
        slideId: 's-1',
      },
      parentComment: null,
      actor: { email: 'owner@example.com', name: 'Owner' },
    });
    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(inputs[0].userEmail, 'sam@example.com');
    assert.strictEqual(inputs[0].notificationType, 'comment_mention');
    assert.strictEqual(inputs[0].title, 'Owner mentioned you in "Deck"');
    assert.strictEqual(inputs[0].body, 'Kijk jij even, @Sam?');
  });

  it('mention wins over comment_created for the owner', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: PRES,
      comment: {
        id: 'c-1',
        body: '@[Owner](user:owner@example.com) wat vind jij?',
        mentions: [{ name: 'Owner', email: 'owner@example.com' }],
      },
      parentComment: null,
      actor: { email: 'other@example.com' },
    });
    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(inputs[0].notificationType, 'comment_mention');
  });

  it('mention wins over comment_reply for the parent author', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: PRES,
      comment: {
        id: 'c-2',
        parentId: 'c-1',
        body: 'Eens met @[Sam](user:sam@example.com)',
        mentions: [{ name: 'Sam', email: 'sam@example.com' }],
      },
      parentComment: { id: 'c-1', authorEmail: 'sam@example.com' },
      actor: { email: 'owner@example.com' },
    });
    const sam = inputs.find((n) => n.userEmail === 'sam@example.com');
    assert.strictEqual(sam.notificationType, 'comment_mention');
  });

  it('self-mention never notifies', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: PRES,
      comment: {
        id: 'c-1',
        body: 'Noteer voor mezelf @[Owner](user:owner@example.com)',
        mentions: [{ name: 'Owner', email: 'owner@example.com' }],
      },
      parentComment: null,
      actor: { email: 'owner@example.com' },
    });
    assert.deepStrictEqual(inputs, []);
  });

  it('falls back to parsing the body when no stored mentions list is passed', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: PRES,
      comment: { id: 'c-1', body: 'Hey @[Sam](user:sam@example.com)' },
      parentComment: null,
      actor: { email: 'owner@example.com' },
    });
    assert.strictEqual(inputs[0]?.notificationType, 'comment_mention');
  });
});
