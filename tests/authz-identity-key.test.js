/**
 * The authorization layer keyed on `users.id` (T10, PR A).
 *
 * tests/authz-matrix-pin.test.js pins the whole decider matrix. This file covers
 * the rule underneath it: what the key *is*.
 *
 * The rule lives in shared/identity-match.js — shared, because the client's
 * advisory mirrors decide the same question the same way:
 *
 *   1. both sides carry a `users.id` and the ids are equal → the same person;
 *   2. anything else → not the same person. No address is ever compared.
 *
 * Rule 1 is why an email is no longer an identity: a matching email cannot buy
 * access to a deck stamped with someone else's id, and a mismatched email cannot
 * take it away from the id it is stamped with. Rule 2 is the retirement of the
 * old address fallback (D22, decision (a)): a stamp whose id column is a defined
 * NULL — a legacy row, an external collaborator — names nobody at all.
 *
 * Run with: node --test tests/authz-identity-key.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.MULTI_ORG_ENABLED;
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

const { belongsInCollection } =
  await import('../server/routes/api/presentations/list.js');
const { canAccessPresentation } =
  await import('../server/routes/public-api/v1/middleware.js');

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const CREATOR_ID = '33333333-3333-4333-8333-333333333333';

// A deck written by the current write paths: both keys per role, the id
// resolved from the email in the same statement (the dual-key invariant).
const dualKeyDeck = {
  id: 'p1',
  visibility: 'private',
  ownerId: OWNER_ID,
  ownerEmail: 'owner@example.com',
  // The creator is a display pair on the way out (D22); its `id` is the key.
  createdBy: { id: CREATOR_ID, displayName: 'Creator' },
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
    assert.equal(
      matchesIdentity(owner, { userId: OWNER_ID, email: 'nobody@example.com' }),
      true,
    );
    assert.equal(
      matchesIdentity(emailTwin, {
        userId: OWNER_ID,
        email: 'owner@example.com',
      }),
      false,
    );
  });
  it('an id missing on either side: nobody matches', () => {
    // The actor has no id: an API key owner with no users row, say.
    assert.equal(
      matchesIdentity(
        { email: 'a@example.com' },
        { userId: OWNER_ID, email: 'a@example.com' },
      ),
      false,
    );
    // The stamp has no id: a legacy row written before the address had an
    // account. It names nobody, not even the person whose address it holds.
    assert.equal(matchesIdentity(owner, { email: 'owner@example.com' }), false);
    assert.equal(
      matchesIdentity(owner, { email: 'someone@example.com' }),
      false,
    );
    // Neither side has one.
    assert.equal(
      matchesIdentity({ email: 'a@example.com' }, { email: 'a@example.com' }),
      false,
    );
  });
  it('the auth-off operator matches every stamp: there is nobody else', () => {
    const operator = { email: 'anonymous', unrestricted: true };
    assert.equal(matchesIdentity(operator, { userId: OWNER_ID }), true);
    assert.equal(matchesIdentity(operator, {}), true);
    assert.equal(isOwnerOrCreator(operator, dualKeyDeck), true);
  });
  it('an actor is identifiable by id alone, by email alone, or not at all', () => {
    // hasIdentity answers "is anyone there?", not "who is this?": an actor
    // known only by an address passes it and still matches no stamp.
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
    assert.equal(
      canReadPresentation({ user: emailTwin, pres: dualKeyDeck }),
      false,
    );
    assert.equal(
      canWritePresentation({ user: emailTwin, pres: dualKeyDeck }),
      false,
    );
    assert.equal(
      canDeletePresentation({ user: emailTwin, pres: dualKeyDeck }),
      false,
    );
    assert.equal(
      canManageCollaborators({ user: emailTwin, pres: dualKeyDeck }),
      false,
    );
    assert.equal(
      canCommentOnPresentation({ user: emailTwin, pres: dualKeyDeck }),
      false,
    );
    assert.equal(
      isPresentationAuthor({ user: emailTwin, pres: dualKeyDeck }),
      false,
    );
    assert.equal(
      getEffectivePermission({ user: emailTwin, pres: dualKeyDeck }),
      'view',
    );
    assert.equal(
      canResolveComment({ user: emailTwin, pres: dualKeyDeck }),
      false,
    );
    assert.equal(
      canDeleteComment({ user: emailTwin, pres: dualKeyDeck, comment: {} }),
      false,
    );
  });
  it('the email twin is not shown the deck in a collection or an API listing', () => {
    assert.equal(
      belongsInCollection({ user: emailTwin, pres: dualKeyDeck }),
      false,
    );
    assert.equal(canAccessPresentation(dualKeyDeck, emailTwin), false);
  });
});

describe('a mismatched email does not remove an identity', () => {
  it('the owner keeps every right under a different email', () => {
    assert.equal(
      canReadPresentation({ user: renamedOwner, pres: dualKeyDeck }),
      true,
    );
    assert.equal(
      canWritePresentation({ user: renamedOwner, pres: dualKeyDeck }),
      true,
    );
    assert.equal(
      canDeletePresentation({ user: renamedOwner, pres: dualKeyDeck }),
      true,
    );
    assert.equal(
      isPresentationAuthor({ user: renamedOwner, pres: dualKeyDeck }),
      true,
    );
    assert.equal(
      getEffectivePermission({ user: renamedOwner, pres: dualKeyDeck }),
      'edit',
    );
    assert.equal(
      belongsInCollection({ user: renamedOwner, pres: dualKeyDeck }),
      true,
    );
    assert.equal(canAccessPresentation(dualKeyDeck, renamedOwner), true);
  });
});

describe('an id-less stamp names nobody (the retired fallback)', () => {
  // An external/legacy row: the address never matched a `users` row, so the id
  // column is a defined NULL (identity-resolver.js). It used to fall back to
  // comparing addresses; D22 decision (a) retired that, which is what lets the
  // address stay out of the response entirely.
  const legacyDeck = {
    id: 'p2',
    visibility: 'private',
    ownerId: null,
    ownerEmail: 'legacy@example.com',
    createdBy: { id: null, displayName: 'Legacy' },
  };
  const legacyUser = { id: OTHER_ID, email: 'legacy@example.com' };

  it('the person whose address is stamped no longer matches it', () => {
    assert.equal(
      canReadPresentation({ user: legacyUser, pres: legacyDeck }),
      false,
    );
    assert.equal(
      canWritePresentation({ user: legacyUser, pres: legacyDeck }),
      false,
    );
    assert.equal(
      canDeletePresentation({ user: legacyUser, pres: legacyDeck }),
      false,
    );
    assert.equal(
      belongsInCollection({ user: legacyUser, pres: legacyDeck }),
      false,
    );
  });
  it('an id-less actor matches a deck that has ids just as little', () => {
    assert.equal(
      canReadPresentation({
        user: { email: 'owner@example.com' },
        pres: dualKeyDeck,
      }),
      false,
    );
  });
  it('an unrelated user is refused on both shapes', () => {
    assert.equal(
      canReadPresentation({ user: stranger, pres: legacyDeck }),
      false,
    );
    assert.equal(
      canReadPresentation({
        user: { email: 'other@example.com' },
        pres: dualKeyDeck,
      }),
      false,
    );
  });
});

describe('one stamp resolved, the other not', () => {
  // Half-resolved rows are normal: a deck created by a real user and later
  // stamped with an external creator address, or the reverse.
  const halfDeck = {
    id: 'p3',
    visibility: 'private',
    ownerId: OWNER_ID,
    ownerEmail: 'owner@example.com',
    createdBy: { id: null, displayName: 'External' },
  };

  it('the owner matches on the id; the external creator matches nothing', () => {
    assert.equal(isOwnerOrCreator(owner, halfDeck), true);
    assert.equal(
      isOwnerOrCreator(
        { id: OTHER_ID, email: 'external@example.com' },
        halfDeck,
      ),
      false,
    );
  });
  it('the email twin of the id-stamped owner is still refused', () => {
    assert.equal(isOwnerOrCreator(emailTwin, halfDeck), false);
  });
});
