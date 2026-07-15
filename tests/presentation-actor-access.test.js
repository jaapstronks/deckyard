/**
 * Tests for actor-based presentation access (checkActorAccess).
 *
 * These are the shared access rules for machine clients (public API keys,
 * MCP sessions), where the actor is identified by email only. Regression
 * guard for the pre-collab authz gap: the public API used an owner/workspace
 * check that ignored the collaborator table and made no read/write
 * distinction, and MCP mutating tools did no per-deck check at all.
 *
 * Run with: node --test tests/presentation-actor-access.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { checkActorAccess } from '../server/utils/presentation-authz/actor-access.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

const privateDeck = { id: 'p1', ownerEmail: OWNER, createdBy: OWNER, scope: 'private' };
const workspaceDeck = { id: 'w1', ownerEmail: OWNER, createdBy: OWNER, scope: 'workspace' };

describe('checkActorAccess — private decks', () => {
  it('owner can read and write', () => {
    assert.equal(checkActorAccess({ pres: privateDeck, actorEmail: OWNER, access: 'read' }), true);
    assert.equal(checkActorAccess({ pres: privateDeck, actorEmail: OWNER, access: 'write' }), true);
  });

  it('non-collaborator can neither read nor write', () => {
    assert.equal(checkActorAccess({ pres: privateDeck, actorEmail: OTHER, access: 'read' }), false);
    assert.equal(checkActorAccess({ pres: privateDeck, actorEmail: OTHER, access: 'write' }), false);
  });

  it('view collaborator can read but not write', () => {
    const opts = { pres: privateDeck, actorEmail: OTHER, collaboratorPermission: 'view' };
    assert.equal(checkActorAccess({ ...opts, access: 'read' }), true);
    assert.equal(checkActorAccess({ ...opts, access: 'write' }), false);
  });

  it('comment collaborator can read but not write', () => {
    const opts = { pres: privateDeck, actorEmail: OTHER, collaboratorPermission: 'comment' };
    assert.equal(checkActorAccess({ ...opts, access: 'read' }), true);
    assert.equal(checkActorAccess({ ...opts, access: 'write' }), false);
  });

  it('edit and admin collaborators can read and write', () => {
    for (const permission of ['edit', 'admin']) {
      const opts = { pres: privateDeck, actorEmail: OTHER, collaboratorPermission: permission };
      assert.equal(checkActorAccess({ ...opts, access: 'read' }), true, `${permission} read`);
      assert.equal(checkActorAccess({ ...opts, access: 'write' }), true, `${permission} write`);
    }
  });
});

describe('checkActorAccess — workspace decks', () => {
  it('any workspace user can read and write a regular workspace deck', () => {
    assert.equal(checkActorAccess({ pres: workspaceDeck, actorEmail: OTHER, access: 'read' }), true);
    assert.equal(checkActorAccess({ pres: workspaceDeck, actorEmail: OTHER, access: 'write' }), true);
  });

  it('view-only workspace decks are readable but not writable by non-owners', () => {
    const viewOnly = { ...workspaceDeck, isViewOnly: true };
    assert.equal(checkActorAccess({ pres: viewOnly, actorEmail: OTHER, access: 'read' }), true);
    assert.equal(checkActorAccess({ pres: viewOnly, actorEmail: OTHER, access: 'write' }), false);
    // The owner keeps write access
    assert.equal(checkActorAccess({ pres: viewOnly, actorEmail: OWNER, access: 'write' }), true);
  });

  it('starter kits are readable but not writable by non-owners', () => {
    const starter = { ...workspaceDeck, isStarterKit: true };
    assert.equal(checkActorAccess({ pres: starter, actorEmail: OTHER, access: 'read' }), true);
    assert.equal(checkActorAccess({ pres: starter, actorEmail: OTHER, access: 'write' }), false);
  });
});

describe('checkActorAccess — edge cases', () => {
  it('defaults to read access', () => {
    assert.equal(checkActorAccess({ pres: privateDeck, actorEmail: OWNER }), true);
    assert.equal(checkActorAccess({ pres: privateDeck, actorEmail: OTHER }), false);
  });

  it('rejects without an actor email', () => {
    assert.equal(checkActorAccess({ pres: workspaceDeck, actorEmail: null, access: 'read' }), false);
    assert.equal(checkActorAccess({ pres: workspaceDeck, actorEmail: '', access: 'write' }), false);
  });

  it('rejects without a presentation', () => {
    assert.equal(checkActorAccess({ pres: null, actorEmail: OWNER }), false);
    assert.equal(checkActorAccess({}), false);
  });

  it('creator (createdBy) counts as owner', () => {
    const created = { id: 'c1', ownerEmail: 'boss@example.com', createdBy: OTHER, scope: 'private' };
    assert.equal(checkActorAccess({ pres: created, actorEmail: OTHER, access: 'write' }), true);
  });
});
