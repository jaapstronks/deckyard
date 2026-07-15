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
const AUTHOR = 'author@example.com';
const BOT = 'dreambot@example.com';

const pres = { ownerEmail: OWNER, createdBy: OWNER };

describe('canDeleteComment', () => {
  it('lets the comment author delete their own comment', () => {
    const comment = { authorEmail: AUTHOR };
    assert.equal(canDeleteComment({ user: { email: AUTHOR }, pres, comment }), true);
  });

  it('lets an admin delete any comment', () => {
    const comment = { authorEmail: BOT };
    assert.equal(
      canDeleteComment({ user: { email: 'someone@else.com', isAdmin: true }, pres, comment }),
      true
    );
  });

  it('lets the presentation owner delete an AI-suggestion comment they did not author', () => {
    const comment = { authorEmail: BOT, commentType: 'ai-suggestion' };
    assert.equal(canDeleteComment({ user: { email: OWNER }, pres, comment }), true);
  });

  it('lets the presentation creator delete a guest/collaborator comment', () => {
    const createdPres = { ownerEmail: 'other@example.com', createdBy: OWNER };
    const comment = { authorEmail: 'guest@example.com' };
    assert.equal(canDeleteComment({ user: { email: OWNER }, pres: createdPres, comment }), true);
  });

  it('does not let an unrelated reader delete someone else\'s comment', () => {
    const comment = { authorEmail: AUTHOR };
    assert.equal(
      canDeleteComment({ user: { email: 'reader@example.com' }, pres, comment }),
      false
    );
  });

  it('returns false without a user email', () => {
    const comment = { authorEmail: AUTHOR };
    assert.equal(canDeleteComment({ user: {}, pres, comment }), false);
  });
});

describe('canEditComment stays author-only (owner cannot rewrite others)', () => {
  it('does not let the owner edit a comment they did not author', () => {
    const comment = { authorEmail: AUTHOR };
    assert.equal(canEditComment({ user: { email: OWNER }, comment }), false);
  });
});
