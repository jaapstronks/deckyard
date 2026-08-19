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
// Identity is the `users.id` and nothing else (shared/identity-match.js); the
// addresses stay in the fixtures because that is what a row also stamps.
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const owner = { id: OWNER_ID, email: OWNER };
const other = { id: OTHER_ID, email: OTHER };

describe('belongsInCollection', () => {
  it('shows organization decks to any authenticated user', () => {
    const pres = {
      id: 'w1',
      ownerId: OWNER_ID,
      ownerEmail: OWNER,
      visibility: 'organization',
    };
    assert.equal(belongsInCollection({ user: other, pres }), true);
  });

  it('shows private decks to their owner and creator', () => {
    const owned = {
      id: 'p1',
      ownerId: OWNER_ID,
      ownerEmail: OWNER,
      visibility: 'private',
    };
    const created = {
      id: 'p2',
      createdById: OWNER_ID,
      createdBy: OWNER,
      visibility: 'private',
    };
    assert.equal(belongsInCollection({ user: owner, pres: owned }), true);
    assert.equal(belongsInCollection({ user: owner, pres: created }), true);
  });

  it('hides private decks from other users', () => {
    const pres = {
      id: 'p1',
      ownerId: OWNER_ID,
      ownerEmail: OWNER,
      createdById: OWNER_ID,
      createdBy: OWNER,
      visibility: 'private',
    };
    assert.equal(belongsInCollection({ user: other, pres }), false);
  });

  it('hides ownerless legacy decks (no owner, no createdBy) from everyone', () => {
    const pres = { id: 'legacy1', visibility: 'private' };
    assert.equal(belongsInCollection({ user: other, pres }), false);
    assert.equal(belongsInCollection({ user: owner, pres }), false);
  });

  it('hides a deck stamped with the address but no owner id', () => {
    // The retired address fallback (D22): a row whose id column is a defined
    // NULL names nobody, so it belongs in no one's collection — the same
    // invariant as the ownerless legacy deck above, and the reason the address
    // no longer has to travel in the response.
    const pres = {
      id: 'p1',
      ownerEmail: OWNER,
      visibility: 'private',
    };
    assert.equal(belongsInCollection({ user: owner, pres }), false);
  });

  it('rejects missing user or presentation', () => {
    assert.equal(
      belongsInCollection({
        user: null,
        pres: { id: 'x', visibility: 'private' },
      }),
      false,
    );
    assert.equal(belongsInCollection({ user: owner, pres: null }), false);
  });
});
