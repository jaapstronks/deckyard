/**
 * The authorization matrix, pinned on the **id-keyed** rule.
 *
 * This is the contract for the identity-decoupling epic (T10; see
 * docs/plans/briefs/identity-decoupling.md). Every ownership/ACL decision keys
 * on the stable `users.id` — an address is not an identity and is never
 * compared (D22; shared/identity-match.js). This file is the proof obligation
 * for the matrix itself: who may do what, cell by cell, so a later change to a
 * decider has to keep every cell green.
 *
 * The matrix was written against the email-keyed layer it replaced and moved
 * over wholesale when the fallback was retired: the *answers* are unchanged,
 * only the key each actor and each deck is identified by. The one row that had
 * to go is "an actor with only an address matches an ownerless deck" — that was
 * the fallback, and it is gone on purpose.
 *
 * The deciders live in `server/utils/presentation-authz/` and are **pure** — they
 * take plain `pres` / `user` / `collaboratorPermission` objects and touch no
 * storage. That is why one file pins the matrix for *both* backends: the file and
 * Postgres adapters differ only in where a `pres` and a collaborator permission
 * come from, not in how the decision is made. The two backend-specific seams are
 * pinned alongside this:
 *   - file mode has no collaborators, so its cells are exactly the rows here with
 *     `collaboratorPermission = null` (identity in the deck JSON);
 *   - Postgres collaborator resolution (`getCollaboratorPermission` feeding these
 *     same functions) is pinned against real PostgreSQL in
 *     tests/pg/collaborator-authz-resolution.pgtest.js.
 *
 * Scope: the **default single-organization install** (multi-organization off, sandbox
 * off), which is the shape the epic touches. Multi-organization org isolation is
 * already pinned in authz-organization-scope{,-multi-org}.test.js and is not
 * re-derived here. A small sandbox-on section pins the two sandbox overrides,
 * since `sandboxEnabled()` is read per call.
 *
 * Run with: node --test tests/authz-matrix-pin.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Default install: single-organization, sandbox off. isMultiOrgEnabled() is
// read at module load (config/features.js), so the env must be cleared before
// the module is evaluated. A static `import` would not guarantee that — static
// imports hoist above this statement — hence the dynamic import below it.
delete process.env.MULTI_ORG_ENABLED;
delete process.env.SANDBOX_MODE;

const {
  canReadPresentation,
  canWritePresentation,
  canDeletePresentation,
  canChangePresentationVisibility,
  canManageCollaborators,
  canCommentOnPresentation,
  canTransferOwnership,
  isPresentationAuthor,
  isUnrestricted,
  getEffectivePermission,
  canResolveComment,
  canEditComment,
  canDeleteComment,
  canGuestComment,
  canGuestEditComment,
  canGuestDeleteComment,
} = await import('../server/utils/presentation-authz.js');

// `isSameOrganization` is the one decider the barrel does not re-export, and
// the share-link decider is not in the barrel at all (see the exhaustiveness
// section at the foot of this file). Both are imported from their modules.
const { isSameOrganization } =
  await import('../server/utils/presentation-authz/presentations.js');
const { canCommentWithShareLink } =
  await import('../server/utils/presentation-authz/share-links.js');

// --- Actors -----------------------------------------------------------------
// Owner and creator are deliberately different emails so a deck can distinguish
// "owns it" from "authored it" — both grant author-level rights today.
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const CREATOR_ID = '33333333-3333-4333-8333-333333333333';
const OWNER = { id: OWNER_ID, email: 'owner@example.com' };
const CREATOR = { id: CREATOR_ID, email: 'creator@example.com' };
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER = { id: OTHER_ID, email: 'other@example.com' };
const ADMIN = { email: 'admin@example.com', isAdmin: true };
const ANON = {}; // no id and no email: an unauthenticated actor
// An actor the instance knows by address alone (an API key whose owner never
// became a user here). They are *someone* — hasIdentity passes — but they are
// nobody in particular, so no ownership stamp is theirs.
const ADDRESS_ONLY = { email: 'owner@example.com' };
const OPERATOR = { email: 'anonymous', unrestricted: true, isAdmin: true };

// --- Decks ------------------------------------------------------------------
// The owner keeps a flat id beside the address a reader of the deck may have;
// the creator arrives as the display pair a response now carries (D22).
const privateDeck = {
  id: 'p1',
  visibility: 'private',
  ownerId: OWNER_ID,
  ownerEmail: 'owner@example.com',
  createdBy: { id: CREATOR_ID, displayName: 'Creator' },
};
const organizationDeck = {
  id: 'w1',
  visibility: 'organization',
  ownerId: OWNER_ID,
  ownerEmail: 'owner@example.com',
  createdBy: { id: CREATOR_ID, displayName: 'Creator' },
};
const viewOnlyOrganizationDeck = {
  ...organizationDeck,
  id: 'wv1',
  isViewOnly: true,
};

// Permission levels a collaborator row can carry (server/constants/permissions).
const VIEW = 'view';
const COMMENT = 'comment';
const EDIT = 'edit';
const ADMIN_PERM = 'admin';

describe('canReadPresentation — private deck', () => {
  it('owner and creator can read', () => {
    assert.equal(canReadPresentation({ user: OWNER, pres: privateDeck }), true);
    assert.equal(
      canReadPresentation({ user: CREATOR, pres: privateDeck }),
      true,
    );
  });
  it('a collaborator with any permission can read', () => {
    for (const p of [VIEW, COMMENT, EDIT, ADMIN_PERM]) {
      assert.equal(
        canReadPresentation({
          user: OTHER,
          pres: privateDeck,
          collaboratorPermission: p,
        }),
        true,
        `collaboratorPermission=${p}`,
      );
    }
  });
  it('an unrelated user cannot read', () => {
    assert.equal(
      canReadPresentation({ user: OTHER, pres: privateDeck }),
      false,
    );
  });
  it('an actor with no identity at all cannot read', () => {
    assert.equal(canReadPresentation({ user: ANON, pres: privateDeck }), false);
  });
  it("an actor known only by the owner's address cannot read", () => {
    assert.equal(
      canReadPresentation({ user: ADDRESS_ONLY, pres: privateDeck }),
      false,
    );
  });
  it('the unrestricted operator can always read', () => {
    assert.equal(
      canReadPresentation({ user: OPERATOR, pres: privateDeck }),
      true,
    );
  });
});

describe('canReadPresentation — organization deck', () => {
  it('any organization member can read, even without an explicit relation', () => {
    assert.equal(
      canReadPresentation({ user: OTHER, pres: organizationDeck }),
      true,
    );
  });
});

describe('canWritePresentation — private deck', () => {
  it('owner and creator can write', () => {
    assert.equal(
      canWritePresentation({ user: OWNER, pres: privateDeck }),
      true,
    );
    assert.equal(
      canWritePresentation({ user: CREATOR, pres: privateDeck }),
      true,
    );
  });
  it('collaborator: edit/admin can write, view/comment cannot', () => {
    assert.equal(
      canWritePresentation({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: EDIT,
      }),
      true,
    );
    assert.equal(
      canWritePresentation({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: ADMIN_PERM,
      }),
      true,
    );
    assert.equal(
      canWritePresentation({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: COMMENT,
      }),
      false,
    );
    assert.equal(
      canWritePresentation({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: VIEW,
      }),
      false,
    );
  });
  it('an unrelated user and an actor with no email cannot write', () => {
    assert.equal(
      canWritePresentation({ user: OTHER, pres: privateDeck }),
      false,
    );
    assert.equal(
      canWritePresentation({ user: ANON, pres: privateDeck }),
      false,
    );
  });
});

describe('canWritePresentation — view-only and organization', () => {
  const viewOnlyPrivate = { ...privateDeck, isViewOnly: true };
  it('the owner can still write a view-only deck (owner check precedes the view-only gate)', () => {
    assert.equal(
      canWritePresentation({ user: OWNER, pres: viewOnlyPrivate }),
      true,
    );
  });
  it('a would-be collaborator is blocked by view-only before permission is consulted', () => {
    assert.equal(
      canWritePresentation({
        user: OTHER,
        pres: viewOnlyPrivate,
        collaboratorPermission: EDIT,
      }),
      false,
    );
  });
  it('any organization member can write a normal organization deck', () => {
    assert.equal(
      canWritePresentation({ user: OTHER, pres: organizationDeck }),
      true,
    );
  });
  it('an organization member cannot write a view-only organization deck', () => {
    assert.equal(
      canWritePresentation({ user: OTHER, pres: viewOnlyOrganizationDeck }),
      false,
    );
  });
});

describe('canDeletePresentation', () => {
  it('only owner and creator can delete — not collaborators, organization members, or admins', () => {
    assert.equal(
      canDeletePresentation({ user: OWNER, pres: privateDeck }),
      true,
    );
    assert.equal(
      canDeletePresentation({ user: CREATOR, pres: privateDeck }),
      true,
    );
    assert.equal(
      canDeletePresentation({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: ADMIN_PERM,
      }),
      false,
    );
    assert.equal(
      canDeletePresentation({ user: OTHER, pres: organizationDeck }),
      false,
    );
    assert.equal(
      canDeletePresentation({ user: ADMIN, pres: privateDeck }),
      false,
    );
  });
  it('the unrestricted operator can delete', () => {
    assert.equal(
      canDeletePresentation({ user: OPERATOR, pres: privateDeck }),
      true,
    );
  });
});

describe('canChangePresentationVisibility', () => {
  it('a no-op scope change is allowed for any authenticated user', () => {
    assert.equal(
      canChangePresentationVisibility({
        user: OTHER,
        pres: privateDeck,
        nextVisibility: 'private',
      }),
      true,
    );
  });
  it('private → organization: owner and creator yes, unrelated user no', () => {
    assert.equal(
      canChangePresentationVisibility({
        user: OWNER,
        pres: privateDeck,
        nextVisibility: 'organization',
      }),
      true,
    );
    assert.equal(
      canChangePresentationVisibility({
        user: CREATOR,
        pres: privateDeck,
        nextVisibility: 'organization',
      }),
      true,
    );
    assert.equal(
      canChangePresentationVisibility({
        user: OTHER,
        pres: privateDeck,
        nextVisibility: 'organization',
      }),
      false,
    );
  });
  it('organization → private is admin-only', () => {
    assert.equal(
      canChangePresentationVisibility({
        user: OWNER,
        pres: organizationDeck,
        nextVisibility: 'private',
      }),
      false,
    );
    assert.equal(
      canChangePresentationVisibility({
        user: ADMIN,
        pres: organizationDeck,
        nextVisibility: 'private',
      }),
      true,
    );
  });
  it('an actor with no email cannot change scope', () => {
    assert.equal(
      canChangePresentationVisibility({
        user: ANON,
        pres: privateDeck,
        nextVisibility: 'organization',
      }),
      false,
    );
  });
  it('the unrestricted operator passes as the owner, without a fast-path', () => {
    // canChangePresentationVisibility still has no isUnrestricted() fast-path.
    // It does not need one: on an auth-off install there is nobody else, so the
    // operator matches every ownership stamp by rule (shared/identity-match.js)
    // and reaches this branch as the owner. The real operator also carries
    // isAdmin, which grants it a line earlier.
    assert.equal(
      canChangePresentationVisibility({
        user: { email: 'anonymous', unrestricted: true },
        pres: privateDeck,
        nextVisibility: 'organization',
      }),
      true,
    );
    // …and an actor with neither flag nor id is still refused.
    assert.equal(
      canChangePresentationVisibility({
        user: ADDRESS_ONLY,
        pres: privateDeck,
        nextVisibility: 'organization',
      }),
      false,
    );
  });
});

describe('canManageCollaborators', () => {
  it('owner and creator can manage', () => {
    assert.equal(
      canManageCollaborators({ user: OWNER, pres: privateDeck }),
      true,
    );
    assert.equal(
      canManageCollaborators({ user: CREATOR, pres: privateDeck }),
      true,
    );
  });
  it('only an admin-level collaborator can manage; edit and below cannot', () => {
    assert.equal(
      canManageCollaborators({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: ADMIN_PERM,
      }),
      true,
    );
    assert.equal(
      canManageCollaborators({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: EDIT,
      }),
      false,
    );
  });
  it('an unrelated user cannot manage', () => {
    assert.equal(
      canManageCollaborators({ user: OTHER, pres: privateDeck }),
      false,
    );
  });
});

describe('canCommentOnPresentation', () => {
  it('owner and creator can comment', () => {
    assert.equal(
      canCommentOnPresentation({ user: OWNER, pres: privateDeck }),
      true,
    );
    assert.equal(
      canCommentOnPresentation({ user: CREATOR, pres: privateDeck }),
      true,
    );
  });
  it('collaborator: comment/edit/admin can comment, view cannot', () => {
    assert.equal(
      canCommentOnPresentation({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: COMMENT,
      }),
      true,
    );
    assert.equal(
      canCommentOnPresentation({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: EDIT,
      }),
      true,
    );
    assert.equal(
      canCommentOnPresentation({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: ADMIN_PERM,
      }),
      true,
    );
    assert.equal(
      canCommentOnPresentation({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: VIEW,
      }),
      false,
    );
  });
  it('any organization member can comment on an organization deck', () => {
    assert.equal(
      canCommentOnPresentation({ user: OTHER, pres: organizationDeck }),
      true,
    );
  });
  it('an unrelated user cannot comment on a private deck', () => {
    assert.equal(
      canCommentOnPresentation({ user: OTHER, pres: privateDeck }),
      false,
    );
  });
});

describe('isPresentationAuthor', () => {
  it('true for owner and creator, false for everyone else', () => {
    assert.equal(
      isPresentationAuthor({ user: OWNER, pres: privateDeck }),
      true,
    );
    assert.equal(
      isPresentationAuthor({ user: CREATOR, pres: privateDeck }),
      true,
    );
    assert.equal(
      isPresentationAuthor({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: ADMIN_PERM,
      }),
      false,
    );
    assert.equal(
      isPresentationAuthor({ user: ANON, pres: privateDeck }),
      false,
    );
  });
});

describe('getEffectivePermission', () => {
  it('owner and creator get edit', () => {
    assert.equal(
      getEffectivePermission({ user: OWNER, pres: privateDeck }),
      'edit',
    );
    assert.equal(
      getEffectivePermission({ user: CREATOR, pres: privateDeck }),
      'edit',
    );
  });
  it('a collaborator falls through to their raw permission verbatim', () => {
    // Pins current behaviour: the fall-through returns collaboratorPermission
    // as-is, so 'admin' surfaces here even though the JSDoc lists edit/comment/view.
    assert.equal(
      getEffectivePermission({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: EDIT,
      }),
      'edit',
    );
    assert.equal(
      getEffectivePermission({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: COMMENT,
      }),
      'comment',
    );
    assert.equal(
      getEffectivePermission({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: VIEW,
      }),
      'view',
    );
    assert.equal(
      getEffectivePermission({
        user: OTHER,
        pres: privateDeck,
        collaboratorPermission: ADMIN_PERM,
      }),
      'admin',
    );
  });
  it('no relation and no email fall back to view', () => {
    assert.equal(
      getEffectivePermission({ user: OTHER, pres: privateDeck }),
      'view',
    );
    assert.equal(
      getEffectivePermission({ user: ANON, pres: privateDeck }),
      'view',
    );
  });
  it('organization member gets edit; view-only organization deck gives comment', () => {
    assert.equal(
      getEffectivePermission({ user: OTHER, pres: organizationDeck }),
      'edit',
    );
    assert.equal(
      getEffectivePermission({ user: OTHER, pres: viewOnlyOrganizationDeck }),
      'comment',
    );
  });
  it('the unrestricted operator always gets edit', () => {
    assert.equal(
      getEffectivePermission({ user: OPERATOR, pres: privateDeck }),
      'edit',
    );
  });
});

describe('comment moderation (canResolveComment / canDeleteComment)', () => {
  it('resolve: admin or owner/creator only', () => {
    assert.equal(canResolveComment({ user: ADMIN, pres: privateDeck }), true);
    assert.equal(canResolveComment({ user: OWNER, pres: privateDeck }), true);
    assert.equal(canResolveComment({ user: CREATOR, pres: privateDeck }), true);
    assert.equal(canResolveComment({ user: OTHER, pres: privateDeck }), false);
    assert.equal(canResolveComment({ user: ANON, pres: privateDeck }), false);
  });
  it('delete: the comment author can delete their own comment', () => {
    const comment = { author: { id: OTHER.id, displayName: 'Other' } };
    assert.equal(
      canDeleteComment({ user: OTHER, pres: privateDeck, comment }),
      true,
    );
  });
  it('delete: the deck owner can moderate anyone else’s comment', () => {
    const comment = { author: { id: OTHER.id, displayName: 'Other' } };
    assert.equal(
      canDeleteComment({ user: OWNER, pres: privateDeck, comment }),
      true,
    );
  });
  it('delete: an unrelated user cannot delete a comment they did not write', () => {
    const comment = { author: { id: 'user-someone-else', displayName: 'Sam' } };
    assert.equal(
      canDeleteComment({ user: OTHER, pres: privateDeck, comment }),
      false,
    );
  });
});

describe('sandbox overrides (SANDBOX_MODE on)', () => {
  // sandboxEnabled() reads process.env per call, so this section toggles it
  // around each assertion rather than needing its own file.
  function withSandbox(fn) {
    process.env.SANDBOX_MODE = 'true';
    try {
      fn();
    } finally {
      delete process.env.SANDBOX_MODE;
    }
  }

  it('organization decks are read-only in sandbox mode — even for the owner', () => {
    withSandbox(() => {
      assert.equal(
        canWritePresentation({ user: OWNER, pres: organizationDeck }),
        false,
      );
      assert.equal(
        canWritePresentation({ user: OTHER, pres: organizationDeck }),
        false,
      );
    });
  });

  it('private decks are unaffected by sandbox mode', () => {
    withSandbox(() => {
      assert.equal(
        canWritePresentation({ user: OWNER, pres: privateDeck }),
        true,
      );
    });
  });

  it('scope changes are refused in sandbox mode for non-admins', () => {
    withSandbox(() => {
      assert.equal(
        canChangePresentationVisibility({
          user: OWNER,
          pres: privateDeck,
          nextVisibility: 'organization',
        }),
        false,
      );
      // Admins still bypass (the isAdmin check precedes the sandbox gate).
      assert.equal(
        canChangePresentationVisibility({
          user: ADMIN,
          pres: privateDeck,
          nextVisibility: 'organization',
        }),
        true,
      );
    });
  });
});

// --- Share links and guests -------------------------------------------------
// The half of the matrix that answers to the **public internet**. Every decider
// above answers about a party the instance already authenticated; these answer
// about an anonymous visitor holding a URL, or a guest who proved only an
// address. A wrong answer here lands outside the organization, not inside it —
// which is why they belong in this file, and why they were the last six without
// a cell (B109). Three of those six were share-link deciders nothing called;
// B112 deleted them rather than keep pinning surface, so four remain.

/** A share link, as the validation layer hands it to a decider. */
const shareLink = (permission, extra = {}) => ({
  id: 'sl1',
  presentationId: privateDeck.id,
  permission,
  revokedAt: null,
  expiresAt: null,
  ...extra,
});

/** Yesterday and tomorrow, relative to the run. */
const HOUR = 60 * 60 * 1000;
const past = () => new Date(Date.now() - HOUR).toISOString();
const future = () => new Date(Date.now() + HOUR).toISOString();

describe('canCommentWithShareLink — the permission ladder', () => {
  // The read and write rungs of this ladder used to live here too, as
  // canRead/canWriteWithShareLink. They had no caller anywhere but this file,
  // so B112 deleted them: a decider nothing asks is not a seam, it is surface.
  // The rungs themselves are unchanged and still pinned — as canRead/canWrite
  // in shared/constants/permissions.js, which is where the ladder lives.
  it('comment and edit grant commenting, view does not', () => {
    assert.equal(canCommentWithShareLink(shareLink(COMMENT)), true);
    assert.equal(canCommentWithShareLink(shareLink(EDIT)), true);
    assert.equal(canCommentWithShareLink(shareLink(VIEW)), false);
  });
  it('an unknown permission string grants nothing', () => {
    assert.equal(canCommentWithShareLink(shareLink('owner')), false);
  });
  it('no link at all grants nothing — the anonymous visitor with no URL', () => {
    for (const absent of [null, undefined, 'sl1', 42]) {
      assert.equal(canCommentWithShareLink(absent), false, String(absent));
    }
  });
});

describe('canCommentWithShareLink — what it deliberately does NOT check', () => {
  // Pinned as a seam, not as an endorsement: it reads `permission` and nothing
  // else, so a revoked or expired link still answers "yes" here. The validation
  // layer that fetches the link is what refuses it — which means a future caller
  // that skips validation gets no protection from this decider. canGuestComment
  // below shows the other shape: it checks both itself.
  it('a revoked link still passes the permission check', () => {
    assert.equal(
      canCommentWithShareLink(shareLink(EDIT, { revokedAt: past() })),
      true,
    );
  });
  it('an expired link still passes the permission check', () => {
    assert.equal(
      canCommentWithShareLink(shareLink(EDIT, { expiresAt: past() })),
      true,
    );
  });
});

describe('canGuestComment — the verified guest on a share link', () => {
  const GUEST_ID = '44444444-4444-4444-8444-444444444444';
  const verifiedGuest = {
    id: GUEST_ID,
    verifiedAt: '2026-01-01T00:00:00.000Z',
  };
  const unverifiedGuest = { id: GUEST_ID, verifiedAt: null };
  const ask = (over = {}) =>
    canGuestComment({
      guest: verifiedGuest,
      shareLink: shareLink(COMMENT),
      presentationId: privateDeck.id,
      ...over,
    });

  it('a verified guest on a comment or edit link may comment', () => {
    assert.equal(ask(), true);
    assert.equal(ask({ shareLink: shareLink(EDIT) }), true);
  });
  it('a view-only link does not let a guest comment', () => {
    assert.equal(ask({ shareLink: shareLink(VIEW) }), false);
  });
  it('an unverified guest may not comment — the address is unproven', () => {
    assert.equal(ask({ guest: unverifiedGuest }), false);
  });
  it('a guest whose link is for another deck may not comment here', () => {
    assert.equal(
      ask({ shareLink: shareLink(COMMENT, { presentationId: 'other-deck' }) }),
      false,
    );
    assert.equal(ask({ presentationId: 'other-deck' }), false);
  });
  it('a revoked link may not be commented through', () => {
    assert.equal(
      ask({ shareLink: shareLink(COMMENT, { revokedAt: past() }) }),
      false,
    );
  });
  it('an expired link may not be commented through, an unexpired one may', () => {
    assert.equal(
      ask({ shareLink: shareLink(COMMENT, { expiresAt: past() }) }),
      false,
    );
    assert.equal(
      ask({ shareLink: shareLink(COMMENT, { expiresAt: future() }) }),
      true,
    );
  });
  it('no guest and no link answer no', () => {
    assert.equal(ask({ guest: null }), false);
    assert.equal(ask({ shareLink: null }), false);
    assert.equal(canGuestComment(), false);
  });
});

describe('canGuestEditComment / canGuestDeleteComment — own comment only', () => {
  const GUEST_ID = '44444444-4444-4444-8444-444444444444';
  const OTHER_GUEST_ID = '55555555-5555-4555-8555-555555555555';
  const guest = { id: GUEST_ID, verifiedAt: '2026-01-01T00:00:00.000Z' };
  const ownComment = { id: 'c1', authorGuestId: GUEST_ID };
  const otherComment = { id: 'c2', authorGuestId: OTHER_GUEST_ID };

  it('a guest may edit and delete the comment they wrote', () => {
    assert.equal(canGuestEditComment({ guest, comment: ownComment }), true);
    assert.equal(canGuestDeleteComment({ guest, comment: ownComment }), true);
  });
  it('a guest may not touch another guest’s comment', () => {
    assert.equal(canGuestEditComment({ guest, comment: otherComment }), false);
    assert.equal(
      canGuestDeleteComment({ guest, comment: otherComment }),
      false,
    );
  });
  it('a comment by a logged-in user carries no authorGuestId, so no guest owns it', () => {
    const userComment = { id: 'c3', author: { id: OTHER_ID } };
    assert.equal(canGuestEditComment({ guest, comment: userComment }), false);
    assert.equal(canGuestDeleteComment({ guest, comment: userComment }), false);
  });
  it('an id-less guest matches nothing, even an id-less comment', () => {
    assert.equal(
      canGuestEditComment({ guest: {}, comment: { authorGuestId: null } }),
      false,
    );
    assert.equal(canGuestEditComment(), false);
    assert.equal(canGuestDeleteComment(), false);
  });
});

// --- The remaining deciders -------------------------------------------------

describe('canTransferOwnership', () => {
  it('the owner may hand the deck over; the creator may not, nor anyone else', () => {
    // The one decider that reads the owner stamp *alone* (D43). Every other
    // ownership-scoped gate takes `isOwnerOrCreator`; this one cannot, because
    // `created_by` is never rewritten and a creator-inclusive grant would
    // outlive the hand-over it authorized.
    assert.equal(
      canTransferOwnership({ user: OWNER, pres: privateDeck }),
      true,
    );
    assert.equal(
      canTransferOwnership({ user: CREATOR, pres: privateDeck }),
      false,
    );
    assert.equal(
      canTransferOwnership({ user: OTHER, pres: privateDeck }),
      false,
    );
    assert.equal(
      canTransferOwnership({ user: ANON, pres: privateDeck }),
      false,
    );
  });
  it('an organization deck is not transferable by any organization member', () => {
    // Reading an organization deck is a membership grant; giving it away is not.
    assert.equal(
      canTransferOwnership({ user: OTHER, pres: organizationDeck }),
      false,
    );
  });
  it('the address-only actor cannot transfer, the operator can', () => {
    assert.equal(
      canTransferOwnership({ user: ADDRESS_ONLY, pres: privateDeck }),
      false,
    );
    assert.equal(
      canTransferOwnership({ user: OPERATOR, pres: privateDeck }),
      true,
    );
  });
});

describe('canEditComment', () => {
  it('only the author may edit their comment — the deck owner may not', () => {
    const comment = { author: { id: OTHER_ID, displayName: 'Other' } };
    assert.equal(canEditComment({ user: OTHER, comment }), true);
    assert.equal(canEditComment({ user: OWNER, comment }), false);
    assert.equal(canEditComment({ user: ANON, comment }), false);
  });
  it('an admin may edit any comment', () => {
    const comment = { author: { id: OTHER_ID, displayName: 'Other' } };
    assert.equal(canEditComment({ user: ADMIN, comment }), true);
  });
  it('a comment with no author is nobody’s to edit', () => {
    assert.equal(canEditComment({ user: OTHER, comment: {} }), false);
    assert.equal(canEditComment(), false);
  });
});

describe('isSameOrganization (single-organization install)', () => {
  // The file's scope: multi-organization on is pinned in
  // authz-organization-scope-multi-org.test.js. With the flag off there is
  // nothing to compare, and the grant answers yes unconditionally — which is
  // what makes every organization-deck row above read the way it does.
  it('answers yes whatever the two organizations say', () => {
    assert.equal(isSameOrganization(OTHER, organizationDeck), true);
    assert.equal(
      isSameOrganization({ organizationId: 'a' }, { organizationId: 'b' }),
      true,
    );
    assert.equal(isSameOrganization(undefined, undefined), true);
  });
});

describe('isUnrestricted', () => {
  // The operator bypass every decider above consults first. It is a flag on the
  // actor, never derived from the deck — so a deck can never make its reader
  // unrestricted.
  it('only an explicit unrestricted:true actor is unrestricted', () => {
    assert.equal(isUnrestricted(OPERATOR), true);
    assert.equal(isUnrestricted(ADMIN), false);
    assert.equal(isUnrestricted(OWNER), false);
    assert.equal(isUnrestricted({ unrestricted: 'true' }), false);
    assert.equal(isUnrestricted(ANON), false);
    assert.equal(isUnrestricted(null), false);
    assert.equal(isUnrestricted(), false);
  });
});

// --- exhaustiveness gate below this line ---
//
// Everything above is a cell. This is the rule that makes the matrix a matrix:
// a decider that is not pinned here cannot be added quietly.
//
// The six share-link and guest deciders reached the public internet with zero
// direct test references (B109) — not because anyone waved them through, but
// because nothing counted. A cell-by-cell matrix that does not know what it is
// missing is a list, not an obligation.
//
// The corpus is the authz layer itself, `server/utils/presentation-authz/`,
// deliberately *not* the `presentation-authz.js` barrel: the barrel does not
// re-export `share-links.js` at all, and scanning it would have reproduced the
// exact blind spot this gate exists to close.
//
// `shared/identity-match.js` sits outside the corpus on purpose — it is shared
// with the client and pinned cell-by-cell in tests/authz-identity-key.test.js.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTHZ_DIR = fileURLToPath(
  new URL('../server/utils/presentation-authz/', import.meta.url),
);

/**
 * Deciders that are exported but not pinned here, each with the reason.
 *
 * Every entry names where the decider *is* covered instead. "Nowhere" is not an
 * allowed reason, and for a while three of the four below said exactly that:
 * this gate recorded them as an open gap (B109) rather than close it. B113 did
 * close it, in tests/actor-access-storage-backed.test.js. They stay listed
 * because they need a database double, not because they are untested.
 *
 * Held to the same two-way honesty as the other allowlists in this repo: an
 * entry whose export disappears fails, and so does an entry that has quietly
 * been pinned after all.
 */
const NOT_PINNED_HERE = {
  canActorAccessPresentation:
    'async and storage-backed (identity resolution + a collaborator lookup); its pure core checkActorAccess delegates to canRead/canWritePresentation, which are pinned above. The wrapper needs a database double, so it belongs in a route or pg test — tests/pg/collaborator-authz-resolution.pgtest.js covers the resolution half.',
  canActorDeletePresentation:
    'async and storage-backed; delegates to canDeletePresentation, pinned above. The wrapper — identity resolution included — is pinned directly in tests/actor-access-storage-backed.test.js, which needs a database double and so cannot live in a pure matrix.',
  canActorResolveComment:
    'async and storage-backed; delegates to canResolveComment, pinned above. The wrapper — identity resolution included — is pinned directly in tests/actor-access-storage-backed.test.js, which needs a database double and so cannot live in a pure matrix.',
  canActorCommentOnPresentation:
    'async and storage-backed; its pure core checkActorCommentAccess delegates to canCommentOnPresentation, pinned above. The wrapper — the collaborator lookup included — is pinned directly in tests/actor-access-storage-backed.test.js, which needs a database double and so cannot live in a pure matrix.',
};

/** Every `can*`/`is*` export in the authz layer, module by module. */
function authzDeciders() {
  const declaration = /^export (?:async )?function ((?:can|is)[A-Za-z0-9_]*)/gm;
  const out = []; // { name, module }
  for (const file of fs.readdirSync(AUTHZ_DIR).sort()) {
    if (!file.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(AUTHZ_DIR, file), 'utf8');
    for (const m of text.matchAll(declaration)) {
      out.push({ name: m[1], module: `presentation-authz/${file}` });
    }
  }
  return out;
}

/**
 * This file with its comments removed.
 *
 * A decider named only in prose is not pinned — before this stripping,
 * `isUnrestricted` "passed" on the strength of one explanatory comment.
 */
const MATRIX_SOURCE = fs
  .readFileSync(fileURLToPath(import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
  // The marker is assembled here so this line cannot match itself.
  .split(['//', '--- exhaustiveness gate below this line ---'].join(' '))[0];

/** Every name this file destructures out of an `await import(...)`. */
const IMPORTED = new Set(
  [...MATRIX_SOURCE.matchAll(/const\s*\{([^}]*)\}\s*=\s*await import\(/g)]
    .flatMap((m) => m[1].split(','))
    .map((n) => n.trim())
    .filter(Boolean),
);

/**
 * A decider is pinned when this file imports it *and* calls it.
 *
 * Both halves matter: importing without asserting pins nothing, and a bare
 * `name(` could be some other function of the same name.
 */
const isPinned = (name) =>
  IMPORTED.has(name) && new RegExp(`\\b${name}\\s*\\(`).test(MATRIX_SOURCE);

const DECIDERS = authzDeciders();

describe('the matrix is exhaustive', () => {
  it('the scan actually sees the authz layer', () => {
    // A silent zero-decider scan would make the assertion below vacuous.
    assert.ok(
      DECIDERS.length > 15,
      `expected the authz layer to export many deciders, got ${DECIDERS.length}`,
    );
    const modules = new Set(DECIDERS.map((d) => d.module));
    for (const expected of [
      'presentation-authz/presentations.js',
      'presentation-authz/comments.js',
      'presentation-authz/guests.js',
      'presentation-authz/share-links.js',
      'presentation-authz/actor-access.js',
    ]) {
      assert.ok(modules.has(expected), `${expected} is missing from the scan`);
    }
  });

  it('every decider is pinned by a cell here, or allowlisted with a reason', () => {
    const unpinned = DECIDERS.filter(
      ({ name }) => !isPinned(name) && !Object.hasOwn(NOT_PINNED_HERE, name),
    );
    assert.deepEqual(
      unpinned.map(({ name, module }) => `${name}  (${module})`),
      [],
      `these authorization deciders have no cell in the matrix:\n` +
        unpinned
          .map(({ name, module }) => `  - ${name}  (${module})`)
          .join('\n') +
        `\n\nAdd a cell above — import the decider and assert its answers — or, ` +
        `if it genuinely cannot be pinned in a pure matrix, add it to ` +
        `NOT_PINNED_HERE with the reason and where it is covered instead.`,
    );
  });

  it('no allowlist entry has gone stale (the allowlist cannot rot)', () => {
    const exported = new Set(DECIDERS.map(({ name }) => name));
    for (const [name, why] of Object.entries(NOT_PINNED_HERE)) {
      assert.ok(
        exported.has(name),
        `NOT_PINNED_HERE lists "${name}" (${why}) but the authz layer no longer exports it — drop the entry.`,
      );
      assert.ok(
        !isPinned(name),
        `NOT_PINNED_HERE lists "${name}" but the matrix now pins it — drop the entry.`,
      );
      assert.ok(
        typeof why === 'string' && why.trim().length > 20,
        `allowlist entry "${name}" needs a real reason, not "${why}"`,
      );
    }
  });
});
