/**
 * Tests for actor-based presentation access (checkActorAccess).
 *
 * These are the shared access rules for machine clients (public API keys,
 * MCP sessions), where the actor is an identity plus the organization its key or
 * session acts in. Regression guard for the pre-collab authz gap: the public
 * API used an owner/organization check that ignored the collaborator table and
 * made no read/write distinction, and MCP mutating tools did no per-deck check
 * at all.
 *
 * These actors state no organization, which in a default single-organization
 * install is exactly right: there is one organization, so `isSameOrganization`
 * answers yes from the feature flag and every assertion below is unchanged by
 * the L10 rewiring. The multi-organization half is in
 * tests/authz-organization-scope-multi-org.test.js.
 *
 * Run with: node --test tests/presentation-actor-access.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { checkActorAccess } from '../server/utils/presentation-authz/actor-access.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';
// The key each side is identified by. A machine actor arrives as an address and
// is resolved to its `users.id` at the boundary (actor-access.js); the deck
// carries the id its create statement resolved. Nothing compares the addresses
// — see shared/identity-match.js.
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const privateDeck = {
  id: 'p1',
  ownerId: OWNER_ID,
  ownerEmail: OWNER,
  createdById: OWNER_ID,
  createdBy: OWNER,
  visibility: 'private',
};
const organizationDeck = {
  id: 'w1',
  ownerId: OWNER_ID,
  ownerEmail: OWNER,
  createdById: OWNER_ID,
  createdBy: OWNER,
  visibility: 'organization',
};

describe('checkActorAccess — private decks', () => {
  it('owner can read and write', () => {
    assert.equal(
      checkActorAccess({
        pres: privateDeck,
        actor: { email: OWNER },
        actorUserId: OWNER_ID,
        access: 'read',
      }),
      true,
    );
    assert.equal(
      checkActorAccess({
        pres: privateDeck,
        actor: { email: OWNER },
        actorUserId: OWNER_ID,
        access: 'write',
      }),
      true,
    );
  });

  it('non-collaborator can neither read nor write', () => {
    assert.equal(
      checkActorAccess({
        pres: privateDeck,
        actor: { email: OTHER },
        actorUserId: OTHER_ID,
        access: 'read',
      }),
      false,
    );
    assert.equal(
      checkActorAccess({
        pres: privateDeck,
        actor: { email: OTHER },
        actorUserId: OTHER_ID,
        access: 'write',
      }),
      false,
    );
  });

  it('view collaborator can read but not write', () => {
    const opts = {
      pres: privateDeck,
      actor: { email: OTHER },
      actorUserId: OTHER_ID,
      collaboratorPermission: 'view',
    };
    assert.equal(checkActorAccess({ ...opts, access: 'read' }), true);
    assert.equal(checkActorAccess({ ...opts, access: 'write' }), false);
  });

  it('comment collaborator can read but not write', () => {
    const opts = {
      pres: privateDeck,
      actor: { email: OTHER },
      actorUserId: OTHER_ID,
      collaboratorPermission: 'comment',
    };
    assert.equal(checkActorAccess({ ...opts, access: 'read' }), true);
    assert.equal(checkActorAccess({ ...opts, access: 'write' }), false);
  });

  it('edit and admin collaborators can read and write', () => {
    for (const permission of ['edit', 'admin']) {
      const opts = {
        pres: privateDeck,
        actor: { email: OTHER },
        actorUserId: OTHER_ID,
        collaboratorPermission: permission,
      };
      assert.equal(
        checkActorAccess({ ...opts, access: 'read' }),
        true,
        `${permission} read`,
      );
      assert.equal(
        checkActorAccess({ ...opts, access: 'write' }),
        true,
        `${permission} write`,
      );
    }
  });
});

describe('checkActorAccess — organization decks', () => {
  it('any organization user can read and write a regular organization deck', () => {
    assert.equal(
      checkActorAccess({
        pres: organizationDeck,
        actor: { email: OTHER },
        actorUserId: OTHER_ID,
        access: 'read',
      }),
      true,
    );
    assert.equal(
      checkActorAccess({
        pres: organizationDeck,
        actor: { email: OTHER },
        actorUserId: OTHER_ID,
        access: 'write',
      }),
      true,
    );
  });

  it('view-only organization decks are readable but not writable by non-owners', () => {
    const viewOnly = { ...organizationDeck, isViewOnly: true };
    assert.equal(
      checkActorAccess({
        pres: viewOnly,
        actor: { email: OTHER },
        actorUserId: OTHER_ID,
        access: 'read',
      }),
      true,
    );
    assert.equal(
      checkActorAccess({
        pres: viewOnly,
        actor: { email: OTHER },
        actorUserId: OTHER_ID,
        access: 'write',
      }),
      false,
    );
    // The owner keeps write access
    assert.equal(
      checkActorAccess({
        pres: viewOnly,
        actor: { email: OWNER },
        actorUserId: OWNER_ID,
        access: 'write',
      }),
      true,
    );
  });
});

describe('checkActorAccess — edge cases', () => {
  it('defaults to read access', () => {
    assert.equal(
      checkActorAccess({
        pres: privateDeck,
        actor: { email: OWNER },
        actorUserId: OWNER_ID,
      }),
      true,
    );
    assert.equal(
      checkActorAccess({
        pres: privateDeck,
        actor: { email: OTHER },
        actorUserId: OTHER_ID,
      }),
      false,
    );
  });

  it('rejects without an actor email', () => {
    assert.equal(
      checkActorAccess({
        pres: organizationDeck,
        actor: { email: null },
        access: 'read',
      }),
      false,
    );
    assert.equal(
      checkActorAccess({
        pres: organizationDeck,
        actor: { email: '' },
        access: 'write',
      }),
      false,
    );
    assert.equal(
      checkActorAccess({ pres: organizationDeck, actor: null, access: 'read' }),
      false,
    );
  });

  it('rejects without a presentation', () => {
    assert.equal(
      checkActorAccess({ pres: null, actor: { email: OWNER } }),
      false,
    );
    assert.equal(checkActorAccess({}), false);
  });

  it('creator (createdBy) counts as owner', () => {
    const created = {
      id: 'c1',
      ownerId: '33333333-3333-4333-8333-333333333333',
      ownerEmail: 'boss@example.com',
      createdBy: { id: OTHER_ID, displayName: 'Other' },
      visibility: 'private',
    };
    assert.equal(
      checkActorAccess({
        pres: created,
        actor: { email: OTHER },
        actorUserId: OTHER_ID,
        access: 'write',
      }),
      true,
    );
  });
});
