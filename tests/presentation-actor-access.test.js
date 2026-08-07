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

const privateDeck = { id: 'p1', ownerEmail: OWNER, createdBy: OWNER, visibility: 'private' };
const organizationDeck = { id: 'w1', ownerEmail: OWNER, createdBy: OWNER, visibility: 'organization' };

describe('checkActorAccess — private decks', () => {
  it('owner can read and write', () => {
    assert.equal(checkActorAccess({ pres: privateDeck, actor: { email: OWNER }, access: 'read' }), true);
    assert.equal(checkActorAccess({ pres: privateDeck, actor: { email: OWNER }, access: 'write' }), true);
  });

  it('non-collaborator can neither read nor write', () => {
    assert.equal(checkActorAccess({ pres: privateDeck, actor: { email: OTHER }, access: 'read' }), false);
    assert.equal(checkActorAccess({ pres: privateDeck, actor: { email: OTHER }, access: 'write' }), false);
  });

  it('view collaborator can read but not write', () => {
    const opts = { pres: privateDeck, actor: { email: OTHER }, collaboratorPermission: 'view' };
    assert.equal(checkActorAccess({ ...opts, access: 'read' }), true);
    assert.equal(checkActorAccess({ ...opts, access: 'write' }), false);
  });

  it('comment collaborator can read but not write', () => {
    const opts = { pres: privateDeck, actor: { email: OTHER }, collaboratorPermission: 'comment' };
    assert.equal(checkActorAccess({ ...opts, access: 'read' }), true);
    assert.equal(checkActorAccess({ ...opts, access: 'write' }), false);
  });

  it('edit and admin collaborators can read and write', () => {
    for (const permission of ['edit', 'admin']) {
      const opts = { pres: privateDeck, actor: { email: OTHER }, collaboratorPermission: permission };
      assert.equal(checkActorAccess({ ...opts, access: 'read' }), true, `${permission} read`);
      assert.equal(checkActorAccess({ ...opts, access: 'write' }), true, `${permission} write`);
    }
  });
});

describe('checkActorAccess — organization decks', () => {
  it('any organization user can read and write a regular organization deck', () => {
    assert.equal(checkActorAccess({ pres: organizationDeck, actor: { email: OTHER }, access: 'read' }), true);
    assert.equal(checkActorAccess({ pres: organizationDeck, actor: { email: OTHER }, access: 'write' }), true);
  });

  it('view-only organization decks are readable but not writable by non-owners', () => {
    const viewOnly = { ...organizationDeck, isViewOnly: true };
    assert.equal(checkActorAccess({ pres: viewOnly, actor: { email: OTHER }, access: 'read' }), true);
    assert.equal(checkActorAccess({ pres: viewOnly, actor: { email: OTHER }, access: 'write' }), false);
    // The owner keeps write access
    assert.equal(checkActorAccess({ pres: viewOnly, actor: { email: OWNER }, access: 'write' }), true);
  });
});

describe('checkActorAccess — edge cases', () => {
  it('defaults to read access', () => {
    assert.equal(checkActorAccess({ pres: privateDeck, actor: { email: OWNER } }), true);
    assert.equal(checkActorAccess({ pres: privateDeck, actor: { email: OTHER } }), false);
  });

  it('rejects without an actor email', () => {
    assert.equal(checkActorAccess({ pres: organizationDeck, actor: { email: null }, access: 'read' }), false);
    assert.equal(checkActorAccess({ pres: organizationDeck, actor: { email: '' }, access: 'write' }), false);
    assert.equal(checkActorAccess({ pres: organizationDeck, actor: null, access: 'read' }), false);
  });

  it('rejects without a presentation', () => {
    assert.equal(checkActorAccess({ pres: null, actor: { email: OWNER } }), false);
    assert.equal(checkActorAccess({}), false);
  });

  it('creator (createdBy) counts as owner', () => {
    const created = { id: 'c1', ownerEmail: 'boss@example.com', createdBy: OTHER, visibility: 'private' };
    assert.equal(checkActorAccess({ pres: created, actor: { email: OTHER }, access: 'write' }), true);
  });
});
