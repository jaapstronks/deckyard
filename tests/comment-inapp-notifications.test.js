/**
 * Tests for the in-app comment-notification payload builder
 * (`buildInAppNotificationInputs` in server/services/comment-notifications.js).
 *
 * The builder is pure (no DB, no SSE), so these tests pin down the full
 * recipient/type contract of phase 1 of the comments-notifications plan:
 * owner gets comment_created, parent author gets comment_reply, reply wins
 * when someone is both, the commenter never notifies themselves, and the
 * actionUrl is slide-anchored. The DB write + SSE broadcast around it follow
 * the existing access-notifications pattern and need a live Postgres.
 *
 * Run with: node --test tests/comment-inapp-notifications.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { buildInAppNotificationInputs } from '../server/services/comment-notifications.js';

const PRES = {
  id: 'pres-1',
  title: 'Q3 Strategy',
  ownerEmail: 'owner@example.com',
};

const COMMENT = {
  id: 'c-10',
  body: 'Looks good to me',
  slideId: 'slide-7',
  parentId: null,
};

describe('buildInAppNotificationInputs', () => {
  it('notifies the owner with comment_created for a top-level comment', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: PRES,
      comment: COMMENT,
      parentComment: null,
      actor: { email: 'colleague@example.com', name: 'Chris' },
    });

    assert.strictEqual(inputs.length, 1);
    const [n] = inputs;
    assert.strictEqual(n.userEmail, 'owner@example.com');
    assert.strictEqual(n.notificationType, 'comment_created');
    assert.strictEqual(n.title, 'Chris commented on "Q3 Strategy"');
    assert.strictEqual(n.body, 'Looks good to me');
    assert.strictEqual(n.presentationId, 'pres-1');
    assert.strictEqual(n.actorEmail, 'colleague@example.com');
  });

  it('anchors the actionUrl to the slide via ?slideId=', () => {
    const [n] = buildInAppNotificationInputs({
      presentation: PRES,
      comment: COMMENT,
      parentComment: null,
      actor: { email: 'colleague@example.com' },
    });
    assert.strictEqual(n.actionUrl, '/app/pres-1?slideId=slide-7');
  });

  it('falls back to the parent comment slide for replies without a slideId', () => {
    const [n] = buildInAppNotificationInputs({
      presentation: PRES,
      comment: { ...COMMENT, slideId: null, parentId: 'c-1' },
      parentComment: { id: 'c-1', authorEmail: 'author@example.com', slideId: 'slide-3' },
      actor: { email: 'colleague@example.com' },
    });
    assert.strictEqual(n.actionUrl, '/app/pres-1?slideId=slide-3');
  });

  it('omits the slide anchor when the comment is not slide-anchored', () => {
    const [n] = buildInAppNotificationInputs({
      presentation: PRES,
      comment: { ...COMMENT, slideId: null },
      parentComment: null,
      actor: { email: 'colleague@example.com' },
    });
    assert.strictEqual(n.actionUrl, '/app/pres-1');
  });

  it('never notifies the commenter about their own comment', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: PRES,
      comment: COMMENT,
      parentComment: null,
      actor: { email: 'owner@example.com', name: 'Owner' },
    });
    assert.deepStrictEqual(inputs, []);
  });

  it('sends comment_reply to the parent author and comment_created to the owner', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: PRES,
      comment: { ...COMMENT, parentId: 'c-1' },
      parentComment: { id: 'c-1', authorEmail: 'author@example.com' },
      actor: { email: 'colleague@example.com', name: 'Chris' },
    });

    assert.strictEqual(inputs.length, 2);
    const byEmail = Object.fromEntries(inputs.map((n) => [n.userEmail, n]));
    assert.strictEqual(byEmail['owner@example.com'].notificationType, 'comment_created');
    assert.strictEqual(byEmail['author@example.com'].notificationType, 'comment_reply');
    assert.strictEqual(
      byEmail['author@example.com'].title,
      'Chris replied to your comment'
    );
  });

  it('reply wins when the owner is also the parent author (single notification)', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: PRES,
      comment: { ...COMMENT, parentId: 'c-1' },
      parentComment: { id: 'c-1', authorEmail: 'owner@example.com' },
      actor: { email: 'colleague@example.com', name: 'Chris' },
    });

    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(inputs[0].userEmail, 'owner@example.com');
    assert.strictEqual(inputs[0].notificationType, 'comment_reply');
  });

  it('deduplicates on email casing differences', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: { ...PRES, ownerEmail: 'Owner@Example.com' },
      comment: { ...COMMENT, parentId: 'c-1' },
      parentComment: { id: 'c-1', authorEmail: 'owner@example.com' },
      actor: { email: 'colleague@example.com' },
    });
    assert.strictEqual(inputs.length, 1);
  });

  it('falls back to the actor email when there is no display name', () => {
    const [n] = buildInAppNotificationInputs({
      presentation: PRES,
      comment: COMMENT,
      parentComment: null,
      actor: { email: 'colleague@example.com' },
    });
    assert.ok(n.title.startsWith('colleague@example.com commented on'));
  });

  it('truncates long comment bodies to an excerpt', () => {
    const [n] = buildInAppNotificationInputs({
      presentation: PRES,
      comment: { ...COMMENT, body: 'x'.repeat(500) },
      parentComment: null,
      actor: { email: 'colleague@example.com' },
    });
    assert.ok(n.body.length <= 140);
    assert.ok(n.body.endsWith('…'));
  });

  it('collapses whitespace/newlines in the excerpt', () => {
    const [n] = buildInAppNotificationInputs({
      presentation: PRES,
      comment: { ...COMMENT, body: 'line one\n\nline   two' },
      parentComment: null,
      actor: { email: 'colleague@example.com' },
    });
    assert.strictEqual(n.body, 'line one line two');
  });

  it('returns [] when there is no owner and no parent author', () => {
    const inputs = buildInAppNotificationInputs({
      presentation: { id: 'p', title: 'T' },
      comment: COMMENT,
      parentComment: null,
      actor: { email: 'someone@example.com' },
    });
    assert.deepStrictEqual(inputs, []);
  });

  it('carries the comment context in data for later phases', () => {
    const [n] = buildInAppNotificationInputs({
      presentation: PRES,
      comment: { ...COMMENT, parentId: 'c-1' },
      parentComment: { id: 'c-1', authorEmail: 'author@example.com' },
      actor: { email: 'owner@example.com' },
    });
    assert.deepStrictEqual(n.data, {
      commentId: 'c-10',
      parentId: 'c-1',
      slideId: 'slide-7',
      presentationTitle: 'Q3 Strategy',
    });
  });
});
