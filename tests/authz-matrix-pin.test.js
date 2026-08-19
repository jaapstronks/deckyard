/**
 * The authorization matrix, pinned against today's **email-keyed** behaviour.
 *
 * This is the contract for the identity-decoupling epic (T10; see
 * docs/plans/briefs/identity-decoupling.md). Every ownership/ACL decision
 * currently compares email strings; the epic rebuilds that layer onto the stable
 * `users.id`. That rebuild must be **behaviour-preserving**, and this file is the
 * proof obligation: it captures who may do what *before* a single call site
 * moves, so a later PR that swaps email for id has to keep every cell green.
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
  isPresentationAuthor,
  getEffectivePermission,
  canResolveComment,
  canDeleteComment,
} = await import('../server/utils/presentation-authz.js');

// --- Actors -----------------------------------------------------------------
// Owner and creator are deliberately different emails so a deck can distinguish
// "owns it" from "authored it" — both grant author-level rights today.
const OWNER = { email: 'owner@example.com' };
const CREATOR = { email: 'creator@example.com' };
const OTHER = { email: 'other@example.com' };
const ADMIN = { email: 'admin@example.com', isAdmin: true };
const ANON = {}; // authenticated shape with no email (or an unauthenticated actor)
const OPERATOR = { email: 'anonymous', unrestricted: true, isAdmin: true };

// --- Decks ------------------------------------------------------------------
const privateDeck = {
  id: 'p1',
  visibility: 'private',
  ownerEmail: 'owner@example.com',
  createdBy: 'creator@example.com',
};
const organizationDeck = {
  id: 'w1',
  visibility: 'organization',
  ownerEmail: 'owner@example.com',
  createdBy: 'creator@example.com',
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
  it('an actor with no email cannot read', () => {
    assert.equal(canReadPresentation({ user: ANON, pres: privateDeck }), false);
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
  it('this decider is NOT short-circuited by the unrestricted flag (email still required)', () => {
    // Pins current behaviour: canChangePresentationVisibility has no isUnrestricted()
    // fast-path. The operator wins here only via its isAdmin flag, not unrestricted.
    assert.equal(
      canChangePresentationVisibility({
        user: { email: 'anonymous', unrestricted: true },
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
    const comment = { authorEmail: 'other@example.com' };
    assert.equal(
      canDeleteComment({ user: OTHER, pres: privateDeck, comment }),
      true,
    );
  });
  it('delete: the deck owner can moderate anyone else’s comment', () => {
    const comment = { authorEmail: 'other@example.com' };
    assert.equal(
      canDeleteComment({ user: OWNER, pres: privateDeck, comment }),
      true,
    );
  });
  it('delete: an unrelated user cannot delete a comment they did not write', () => {
    const comment = { authorEmail: 'someoneelse@example.com' };
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
