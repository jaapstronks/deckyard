/**
 * The three storage-backed actor deciders, named by a test at last (B113).
 *
 * `server/utils/presentation-authz/actor-access.js` is the machine-client half
 * of the authorization layer: the public API and the MCP tools do not carry a
 * browser session, so every check there goes through an **actor**
 * (`{ email, organizationId }`) whose identity has to be *resolved* before any
 * decision can be made. That resolution is a database read, which is why these
 * three cannot live in tests/authz-matrix-pin.test.js — that file pins the pure
 * deciders, and pure is exactly what these are not.
 *
 * The matrix registered them as a gap with a reason (#894, `NOT_PINNED_HERE`)
 * and did not close it. This file closes it, in the house shape for
 * storage-backed behaviour: the in-memory double from `tests/helpers/fake-db.js`
 * installed with `__setTestDb()`, no live PostgreSQL (see
 * docs/developer/dev-setup.md § Testing storage behaviour without PostgreSQL).
 *
 * ## What the storage read actually decides
 *
 * Two lookups sit behind these deciders, and both change answers:
 *
 *   1. **identity resolution** (`resolveIdentityByEmail` → `users`). Ownership
 *      keys on `users.id` and on nothing else (D22; shared/identity-match.js),
 *      so an actor whose address matches `pres.ownerEmail` but who has **no
 *      user row on this instance** is still not the owner. That row is only
 *      "absent" because the query ran and came back empty — pin it, or the
 *      difference between "resolved to somebody else" and "resolved to nobody"
 *      is untested.
 *   2. **collaborator resolution** (`getCollaboratorPermission` →
 *      `presentation_collaborators`), which only
 *      `canActorCommentOnPresentation` performs. Its `revoked_at is null`
 *      clause and the fact that a collaborator needs no user record at all are
 *      both decisions, not plumbing.
 *
 * Scope: the default single-organization install, like the matrix. Collaborator
 * resolution against *real* PostgreSQL is pinned in
 * tests/pg/collaborator-authz-resolution.pgtest.js; this file is about the three
 * deciders composed on top of it.
 *
 * Run with: node --test tests/actor-access-storage-backed.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Default install: single-organization, sandbox off — read at module load in
// config/features.js, so both must be gone before the deciders are imported.
delete process.env.MULTI_ORG_ENABLED;
delete process.env.SANDBOX_MODE;
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
// `__resetStorageForTests` rather than `closeStorage`: the double is not a real
// Kysely handle, so closing it would call a `destroy()` it does not have.
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const {
  canActorDeletePresentation,
  canActorResolveComment,
  canActorCommentOnPresentation,
} = await import('../server/utils/presentation-authz/actor-access.js');

// --- Actors -----------------------------------------------------------------
// OWNER and CREATOR are different people so a deck can distinguish "owns it"
// from "authored it". STRANGER is a user of this instance who is neither.
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const CREATOR_ID = '33333333-3333-4333-8333-333333333333';
const STRANGER_ID = '22222222-2222-4222-8222-222222222222';

const OWNER = { email: 'owner@example.com', organizationId: ORG };
const CREATOR = { email: 'creator@example.com', organizationId: ORG };
const STRANGER = { email: 'stranger@example.com', organizationId: ORG };

// An API key whose owner never became a user here. The address is the *owner's*
// address on purpose: the only thing standing between this actor and the deck
// is that the `users` lookup finds nothing (D22).
const ADDRESS_ONLY = { email: 'owner@example.com', organizationId: ORG };
// The same, under an address nobody on this instance shares — the external
// collaborator's shape.
const EXTERNAL = { email: 'external@partner.example', organizationId: ORG };
// No identity at all: an unauthenticated caller reaching a machine surface.
const ANON = {};

/** The users this instance knows. ADDRESS_ONLY/EXTERNAL are deliberately absent. */
const KNOWN_USERS = [
  { id: OWNER_ID, email: 'seeded-owner@example.com', name: 'Olive' },
  { id: CREATOR_ID, email: CREATOR.email, name: 'Cy' },
  { id: STRANGER_ID, email: STRANGER.email, name: 'Sam' },
];

// --- Decks ------------------------------------------------------------------
// Plain objects, exactly as the deciders receive them: these three take a
// `pres` the caller already fetched, so no presentation rows are seeded.
// `ownerEmail` is `owner@example.com` while the owner's *user row* carries a
// different address — that is what makes ADDRESS_ONLY a real test rather than a
// coincidence: matching the deck's address grants nothing on its own.
const deck = (id, over = {}) => ({
  id,
  visibility: 'private',
  ownerId: OWNER_ID,
  ownerEmail: 'owner@example.com',
  createdBy: { id: CREATOR_ID, displayName: 'Cy' },
  ...over,
});

/** A collaborator row with the column defaults the migrations give it. */
const collaboratorRow = (over) => ({
  organization_id: ORG,
  user_id: null,
  invited_by: 'owner@example.com',
  invited_at: '2026-01-01T00:00:00.000Z',
  accepted_at: '2026-01-01T00:00:00.000Z',
  revoked_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

// Each scenario gets its own deck id: `getCollaboratorPermission` memoizes on
// `(presentationId, email)`, so sharing one id across cases would let the first
// answer decide the rest.
const COMMENT_COLLAB_DECK = 'deck-collab-comment';
const VIEW_COLLAB_DECK = 'deck-collab-view';
const REVOKED_COLLAB_DECK = 'deck-collab-revoked';
const EXTERNAL_COLLAB_DECK = 'deck-collab-external';

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: KNOWN_USERS.map((u) => ({
        id: u.id,
        organization_id: ORG,
        email: u.email,
        name: u.name,
        role: 'user',
        auth_source: 'database',
        password_hash: null,
        settings: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })),
      presentation_collaborators: [
        collaboratorRow({
          id: 'c-comment',
          presentation_id: COMMENT_COLLAB_DECK,
          user_email: STRANGER.email,
          permission: 'comment',
        }),
        collaboratorRow({
          id: 'c-view',
          presentation_id: VIEW_COLLAB_DECK,
          user_email: STRANGER.email,
          permission: 'view',
        }),
        collaboratorRow({
          id: 'c-revoked',
          presentation_id: REVOKED_COLLAB_DECK,
          user_email: STRANGER.email,
          permission: 'edit',
          revoked_at: '2026-02-01T00:00:00.000Z',
        }),
        collaboratorRow({
          id: 'c-external',
          presentation_id: EXTERNAL_COLLAB_DECK,
          user_email: EXTERNAL.email,
          permission: 'comment',
        }),
      ],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

// ---------------------------------------------------------------------------
// canActorDeletePresentation
// ---------------------------------------------------------------------------

test('canActorDeletePresentation — the owner deletes their own deck', async () => {
  // The address resolves to OWNER_ID, and OWNER_ID is the deck's ownerId. Both
  // halves are needed: the address alone is checked nowhere.
  assert.equal(
    await canActorDeletePresentation(deck('d1'), {
      ...OWNER,
      email: 'seeded-owner@example.com',
    }),
    true,
  );
});

test('canActorDeletePresentation — the creator may delete what they authored', async () => {
  assert.equal(await canActorDeletePresentation(deck('d2'), CREATOR), true);
});

test('canActorDeletePresentation — another user of the instance may not', async () => {
  assert.equal(await canActorDeletePresentation(deck('d3'), STRANGER), false);
});

test('canActorDeletePresentation — an organization deck is still only the owner’s to delete', async () => {
  // Wider visibility grants reading, never deleting: the one grant that would
  // otherwise reach a same-organization user does not apply here.
  assert.equal(
    await canActorDeletePresentation(
      deck('d4', { visibility: 'organization' }),
      STRANGER,
    ),
    false,
  );
});

test('canActorDeletePresentation — an address with no user row is nobody in particular', async () => {
  // The lookup is what decides this: ADDRESS_ONLY carries the deck's exact
  // ownerEmail. It is refused because `users` has no row for that address, so
  // the actor holds no id — and an id-less actor matches no ownership stamp.
  assert.equal(
    await canActorDeletePresentation(deck('d5'), ADDRESS_ONLY),
    false,
  );
});

test('canActorDeletePresentation — an actor with no identity is refused', async () => {
  assert.equal(await canActorDeletePresentation(deck('d6'), ANON), false);
  assert.equal(await canActorDeletePresentation(deck('d6'), undefined), false);
});

test('canActorDeletePresentation — a pre-resolved id skips the lookup and still decides', async () => {
  // The public API resolves the key owner once per request and passes the id
  // down; `resolveActorUserId` short-circuits on it. The address here belongs
  // to nobody, which proves the id is what answered.
  assert.equal(
    await canActorDeletePresentation(deck('d7'), {
      id: OWNER_ID,
      email: 'nobody@example.com',
      organizationId: ORG,
    }),
    true,
  );
});

test('canActorDeletePresentation — no presentation, no decision', async () => {
  for (const absent of [null, undefined, 'd8', 42]) {
    assert.equal(
      await canActorDeletePresentation(absent, CREATOR),
      false,
      String(absent),
    );
  }
});

// ---------------------------------------------------------------------------
// canActorResolveComment
// ---------------------------------------------------------------------------

test('canActorResolveComment — the owner and the creator moderate their deck', async () => {
  assert.equal(
    await canActorResolveComment(deck('r1'), {
      ...OWNER,
      email: 'seeded-owner@example.com',
    }),
    true,
  );
  assert.equal(await canActorResolveComment(deck('r2'), CREATOR), true);
});

test('canActorResolveComment — another user of the instance may not moderate', async () => {
  assert.equal(await canActorResolveComment(deck('r3'), STRANGER), false);
});

test('canActorResolveComment — a collaborator may rewrite the deck but not moderate it', async () => {
  // STRANGER holds `comment` on this deck (seeded), which is exactly what
  // canActorCommentOnPresentation below grants. Moderation is deck-ownership
  // only, and this decider never asks for the collaborator row at all.
  assert.equal(
    await canActorResolveComment(deck(COMMENT_COLLAB_DECK), STRANGER),
    false,
  );
});

test('canActorResolveComment — an address with no user row is nobody in particular', async () => {
  assert.equal(await canActorResolveComment(deck('r4'), ADDRESS_ONLY), false);
});

test('canActorResolveComment — an actor with no identity is refused', async () => {
  assert.equal(await canActorResolveComment(deck('r5'), ANON), false);
  assert.equal(await canActorResolveComment(deck('r5'), undefined), false);
});

test('canActorResolveComment — no presentation, no decision', async () => {
  assert.equal(await canActorResolveComment(null, CREATOR), false);
});

// ---------------------------------------------------------------------------
// canActorCommentOnPresentation — the one that reads the collaborator row
// ---------------------------------------------------------------------------

test('canActorCommentOnPresentation — the owner and the creator may comment', async () => {
  assert.equal(
    await canActorCommentOnPresentation(deck('k1'), {
      ...OWNER,
      email: 'seeded-owner@example.com',
    }),
    true,
  );
  assert.equal(await canActorCommentOnPresentation(deck('k2'), CREATOR), true);
});

test('canActorCommentOnPresentation — a stranger with no row on a private deck may not', async () => {
  assert.equal(
    await canActorCommentOnPresentation(deck('k3'), STRANGER),
    false,
  );
});

test('canActorCommentOnPresentation — a collaborator with comment permission may', async () => {
  // The grant comes out of `presentation_collaborators`: same actor, same deck
  // shape as the refused case above, one seeded row apart.
  assert.equal(
    await canActorCommentOnPresentation(deck(COMMENT_COLLAB_DECK), STRANGER),
    true,
  );
});

test('canActorCommentOnPresentation — a view-only collaborator may not', async () => {
  assert.equal(
    await canActorCommentOnPresentation(deck(VIEW_COLLAB_DECK), STRANGER),
    false,
  );
});

test('canActorCommentOnPresentation — a revoked collaborator row grants nothing', async () => {
  // The row still says `edit`; only `revoked_at` separates it from access. That
  // clause lives in the query, so nothing but a real read can pin it.
  assert.equal(
    await canActorCommentOnPresentation(deck(REVOKED_COLLAB_DECK), STRANGER),
    false,
  );
});

test('canActorCommentOnPresentation — a collaborator needs no user record', async () => {
  // EXTERNAL has no `users` row, so it resolves to no id and owns nothing —
  // and it is still granted, because a collaborator row is keyed on the address
  // it was invited by. Losing this path would silently lock out every external
  // collaborator, which is why it is pinned here and in the pg suite.
  assert.equal(
    await canActorCommentOnPresentation(deck(EXTERNAL_COLLAB_DECK), EXTERNAL),
    true,
  );
});

test('canActorCommentOnPresentation — an organization deck lets any user of it comment', async () => {
  // Single-organization install: `isSameOrganization` answers yes from the
  // feature flag, so organization visibility is the whole grant. Multi-organization
  // isolation is pinned in authz-organization-scope-multi-org.test.js.
  assert.equal(
    await canActorCommentOnPresentation(
      deck('k4', { visibility: 'organization' }),
      STRANGER,
    ),
    true,
  );
});

test('canActorCommentOnPresentation — an actor with no identity is refused', async () => {
  // Also the one case where no lookup happens at all: without an address there
  // is no collaborator row to ask for.
  assert.equal(
    await canActorCommentOnPresentation(
      deck('k5', { visibility: 'organization' }),
      ANON,
    ),
    false,
  );
  assert.equal(
    await canActorCommentOnPresentation(deck('k5'), undefined),
    false,
  );
});

test('canActorCommentOnPresentation — no presentation, no decision', async () => {
  assert.equal(await canActorCommentOnPresentation(null, CREATOR), false);
});
