/**
 * Tests for the Home/overview collection filter (belongsInCollection).
 *
 * Regression guard for the 2026-07-16 privacy leak: ownerless "legacy"
 * presentations were shown to every authenticated user on Home, while the
 * view route refused to open them. Invariant: a deck card only appears
 * when the user could also open the deck.
 *
 * Run with: node --test tests/home-collection-authz.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { belongsInCollection } from '../server/routes/api/presentations/list.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

describe('belongsInCollection', () => {
  it('shows workspace decks to any authenticated user', () => {
    const pres = { id: 'w1', ownerEmail: OWNER, scope: 'workspace' };
    assert.equal(belongsInCollection({ user: { email: OTHER }, pres }), true);
  });

  it('shows private decks to their owner and creator', () => {
    const owned = { id: 'p1', ownerEmail: OWNER, scope: 'private' };
    const created = { id: 'p2', createdBy: OWNER, scope: 'private' };
    assert.equal(belongsInCollection({ user: { email: OWNER }, pres: owned }), true);
    assert.equal(belongsInCollection({ user: { email: OWNER }, pres: created }), true);
  });

  it('hides private decks from other users', () => {
    const pres = { id: 'p1', ownerEmail: OWNER, createdBy: OWNER, scope: 'private' };
    assert.equal(belongsInCollection({ user: { email: OTHER }, pres }), false);
  });

  it('hides ownerless legacy decks (no owner, no createdBy) from everyone', () => {
    const pres = { id: 'legacy1', scope: 'private' };
    assert.equal(belongsInCollection({ user: { email: OTHER }, pres }), false);
    assert.equal(belongsInCollection({ user: { email: OWNER }, pres }), false);
  });

  it('matches owner email case-insensitively', () => {
    const pres = { id: 'p1', ownerEmail: 'Owner@Example.com', scope: 'private' };
    assert.equal(belongsInCollection({ user: { email: OWNER }, pres }), true);
  });

  it('rejects missing user or presentation', () => {
    assert.equal(belongsInCollection({ user: null, pres: { id: 'x', scope: 'private' } }), false);
    assert.equal(belongsInCollection({ user: { email: OWNER }, pres: null }), false);
  });
});
