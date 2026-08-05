/**
 * The authorization layer keyed on `users.id` (T10, PR A).
 *
 * tests/authz-matrix-pin.test.js pins what the deciders answer for the shapes
 * that carry **no** user id — file mode, legacy rows, bare `{ email }` actors —
 * and stays green unchanged. This file covers the other half: what happens once
 * both sides carry the stable key, and where the email fallback still applies.
 *
 * The rule under test lives in server/utils/presentation-authz/identity-match.js:
 *
 *   1. actor id + stamped id present → the ids decide, no email is consulted;
 *   2. either missing → the emails decide, exactly as before.
 *
 * Rule 1 is why an email is no longer an identity: a matching email cannot buy
 * access to a deck stamped with someone else's id, and a mismatched email cannot
 * take it away from the id it is stamped with.
 *
 * Run with: node --test tests/authz-identity-key.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.MULTI_WORKSPACE_ENABLED;
delete process.env.SANDBOX_MODE;

const {
  canReadPresentation,
  canWritePresentation,
  canDeletePresentation,
  canManageCollaborators,
  canCommentOnPresentation,
  isPresentationAuthor,
  getEffectivePermission,
  canResolveComment,
  canDeleteComment,
  isOwnerOrCreator,
  matchesIdentity,
  hasIdentity,
} = await import('../server/utils/presentation-authz.js');

const { belongsInCollection } = await import('../server/routes/api/presentations/list.js');
const { canAccessPresentation } = await import('../server/routes/public-api/v1/middleware.js');

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const CREATOR_ID = '33333333-3333-4333-8333-333333333333';

// A deck written by the current write paths: both keys per role, the id
// resolved from the email in the same statement (the dual-key invariant).
const dualKeyDeck = {
  id: 'p1',
  scope: 'private',
  ownerId: OWNER_ID,
  ownerEmail: 'owner@example.com',
  createdById: CREATOR_ID,
  createdBy: 'creator@example.com',
};

const owner = { id: OWNER_ID, email: 'owner@example.com' };
const creator = { id: CREATOR_ID, email: 'creator@example.com' };
const stranger = { id: OTHER_ID, email: 'other@example.com' };

// The case the whole epic exists for: someone whose email string matches the
// deck's stamp but who is a different `users` row.
const emailTwin = { id: OTHER_ID, email: 'owner@example.com' };
// And its mirror: the real owner reaching the deck under another email.
const renamedOwner = { id: OWNER_ID, email: 'owner-new@example.com' };

describe('identity-match — the rule itself', () => {
  it('two ids present: only the ids decide', () => {
    assert.equal(matchesIdentity(owner, { userId: OWNER_ID, email: 'nobody@example.com' }), true);
    assert.equal(matchesIdentity(emailTwin, { userId: OWNER_ID, email: 'owner@example.com' }), false);
  });
  it('an id missing on either side: the emails decide', () => {
    assert.equal(matchesIdentity({ email: 'a@example.com' }, { userId: OWNER_ID, email: 'a@example.com' }), true);
    assert.equal(matchesIdentity(owner, { email: 'owner@example.com' }), true);
    assert.equal(matchesIdentity(owner, { email: 'someone@example.com' }), false);
  });
  it('an actor is identifiable by id alone, by email alone, or not at all', () => {
    assert.equal(hasIdentity({ id: OWNER_ID }), true);
    assert.equal(hasIdentity({ email: 'a@example.com' }), true);
    assert.equal(hasIdentity({}), false);
    assert.equal(hasIdentity(null), false);
  });
  it('owner and creator are both author stamps', () => {
    assert.equal(isOwnerOrCreator(owner, dualKeyDeck), true);
    assert.equal(isOwnerOrCreator(creator, dualKeyDeck), true);
    assert.equal(isOwnerOrCreator(stranger, dualKeyDeck), false);
    assert.equal(isOwnerOrCreator(owner, null), false);
  });
});

describe('a matching email is not an identity', () => {
  it('the email twin gets nothing the deck grants its owner', () => {
    assert.equal(canReadPresentation({ user: emailTwin, pres: dualKeyDeck }), false);
    assert.equal(canWritePresentation({ user: emailTwin, pres: dualKeyDeck }), false);
    assert.equal(canDeletePresentation({ user: emailTwin, pres: dualKeyDeck }), false);
    assert.equal(canManageCollaborators({ user: emailTwin, pres: dualKeyDeck }), false);
    assert.equal(canCommentOnPresentation({ user: emailTwin, pres: dualKeyDeck }), false);
    assert.equal(isPresentationAuthor({ user: emailTwin, pres: dualKeyDeck }), false);
    assert.equal(getEffectivePermission({ user: emailTwin, pres: dualKeyDeck }), 'view');
    assert.equal(canResolveComment({ user: emailTwin, pres: dualKeyDeck }), false);
    assert.equal(canDeleteComment({ user: emailTwin, pres: dualKeyDeck, comment: {} }), false);
  });
  it('the email twin is not shown the deck in a collection or an API listing', () => {
    assert.equal(belongsInCollection({ user: emailTwin, pres: dualKeyDeck }), false);
    assert.equal(canAccessPresentation(dualKeyDeck, emailTwin), false);
  });
});

describe('a mismatched email does not remove an identity', () => {
  it('the owner keeps every right under a different email', () => {
    assert.equal(canReadPresentation({ user: renamedOwner, pres: dualKeyDeck }), true);
    assert.equal(canWritePresentation({ user: renamedOwner, pres: dualKeyDeck }), true);
    assert.equal(canDeletePresentation({ user: renamedOwner, pres: dualKeyDeck }), true);
    assert.equal(isPresentationAuthor({ user: renamedOwner, pres: dualKeyDeck }), true);
    assert.equal(getEffectivePermission({ user: renamedOwner, pres: dualKeyDeck }), 'edit');
    assert.equal(belongsInCollection({ user: renamedOwner, pres: dualKeyDeck }), true);
    assert.equal(canAccessPresentation(dualKeyDeck, renamedOwner), true);
  });
});

describe('the email fallback covers the id-less shapes', () => {
  // An external/legacy row: the email never matched a `users` row, so the id
  // column is a defined NULL (identity-resolver.js). Behaviour must be exactly
  // what it was before the id existed.
  const legacyDeck = {
    id: 'p2',
    scope: 'private',
    ownerId: null,
    ownerEmail: 'legacy@example.com',
    createdById: null,
    createdBy: 'legacy@example.com',
  };
  const legacyUser = { id: OTHER_ID, email: 'legacy@example.com' };

  it('an id-carrying user still matches a deck stamped only by email', () => {
    assert.equal(canReadPresentation({ user: legacyUser, pres: legacyDeck }), true);
    assert.equal(canWritePresentation({ user: legacyUser, pres: legacyDeck }), true);
    assert.equal(canDeletePresentation({ user: legacyUser, pres: legacyDeck }), true);
  });
  it('an id-less user (file mode, dev bypass) still matches a deck that has ids', () => {
    assert.equal(canReadPresentation({ user: { email: 'owner@example.com' }, pres: dualKeyDeck }), true);
  });
  it('an unrelated user is still refused on both shapes', () => {
    assert.equal(canReadPresentation({ user: stranger, pres: legacyDeck }), false);
    assert.equal(canReadPresentation({ user: { email: 'other@example.com' }, pres: dualKeyDeck }), false);
  });
});

describe('one stamp resolved, the other not', () => {
  // Half-resolved rows are normal: a deck created by a real user and later
  // stamped with an external creator email, or the reverse.
  const halfDeck = {
    id: 'p3',
    scope: 'private',
    ownerId: OWNER_ID,
    ownerEmail: 'owner@example.com',
    createdById: null,
    createdBy: 'external@example.com',
  };

  it('the owner matches on the id, the external creator on the email', () => {
    assert.equal(isOwnerOrCreator(owner, halfDeck), true);
    assert.equal(isOwnerOrCreator({ id: OTHER_ID, email: 'external@example.com' }, halfDeck), true);
  });
  it('the email twin of the id-stamped owner is still refused', () => {
    assert.equal(isOwnerOrCreator(emailTwin, halfDeck), false);
  });
});
