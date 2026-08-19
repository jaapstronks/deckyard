/**
 * Tests for comment delete authorization.
 *
 * Regression: a presentation owner could not delete comments they did not
 * author (AI suggestions, guest/collaborator feedback) - the delete returned
 * 401 and the comment stayed visible. Owners/creators must be able to
 * moderate (delete) any comment on their own presentation.
 *
 * Run with: node --test tests/comment-delete-authz.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  canDeleteComment,
  canEditComment,
} from '../server/utils/presentation-authz/comments.js';

const OWNER = 'owner@example.com';
const AUTHOR_ID = 'user-author';
const BOT_ID = 'user-bot';
// Deck ownership and comment authorship are both decided on the `users.id`
// (shared/identity-match.js): a comment names its author with
// `{ id, displayName }` and hands out no address (D22).
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const owner = { id: OWNER_ID, email: OWNER };

const pres = {
  ownerId: OWNER_ID,
  ownerEmail: OWNER,
  createdBy: { id: OWNER_ID, displayName: 'Owner' },
};

describe('canDeleteComment', () => {
  it('lets the comment author delete their own comment', () => {
    const comment = { author: { id: AUTHOR_ID, displayName: 'Andy' } };
    assert.equal(
      canDeleteComment({ user: { id: AUTHOR_ID }, pres, comment }),
      true,
    );
  });

  it('lets an admin delete any comment', () => {
    const comment = { author: { id: BOT_ID, displayName: 'Bot' } };
    assert.equal(
      canDeleteComment({
        user: { id: 'user-admin', isAdmin: true },
        pres,
        comment,
      }),
      true,
    );
  });

  it('lets the presentation owner delete an AI-suggestion comment they did not author', () => {
    const comment = {
      author: { id: BOT_ID, displayName: 'Bot' },
      commentType: 'ai-suggestion',
    };
    assert.equal(canDeleteComment({ user: owner, pres, comment }), true);
  });

  it('lets the presentation creator delete a guest/collaborator comment', () => {
    const createdPres = {
      ownerId: '22222222-2222-4222-8222-222222222222',
      ownerEmail: 'other@example.com',
      createdBy: { id: OWNER_ID, displayName: 'Owner' },
    };
    const comment = { author: null, authorGuestId: 'guest-1' };
    assert.equal(
      canDeleteComment({ user: owner, pres: createdPres, comment }),
      true,
    );
  });

  it("does not let an unrelated reader delete someone else's comment", () => {
    const comment = { author: { id: AUTHOR_ID, displayName: 'Andy' } };
    assert.equal(
      canDeleteComment({
        user: { id: 'user-reader' },
        pres,
        comment,
      }),
      false,
    );
  });

  it('returns false without a user email', () => {
    const comment = { author: { id: AUTHOR_ID, displayName: 'Andy' } };
    assert.equal(canDeleteComment({ user: {}, pres, comment }), false);
  });
});

describe('canEditComment stays author-only (owner cannot rewrite others)', () => {
  it('does not let the owner edit a comment they did not author', () => {
    const comment = { author: { id: AUTHOR_ID, displayName: 'Andy' } };
    assert.equal(canEditComment({ user: owner, comment }), false);
  });
});
