/**
 * Auth-off "unrestricted" operator: with AUTH_ENABLED=false the anonymous admin
 * is the single trusted local operator and every ownership-scoped authz check
 * grants access, regardless of the deck's ownerEmail. This is what makes
 * MCP-created decks (owned by DECKYARD_MCP_OWNER_EMAIL) openable in the browser
 * on a default file-storage install. A real (auth-enabled) user never carries
 * the flag, so the bypass cannot widen access in a multi-user deployment.
 *
 * Run with: node --test tests/authz-unrestricted.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  isUnrestricted,
  canReadPresentation,
  canWritePresentation,
  canDeletePresentation,
  canCommentOnPresentation,
  getEffectivePermission,
} from '../server/utils/presentation-authz.js';
import { belongsInCollection } from '../server/routes/api/presentations/list.js';

const OPERATOR = { email: 'anonymous', role: 'admin', isAdmin: true, unrestricted: true };
const OTHER = { email: 'someone@else.com' };
// A private deck owned by a different email (as MCP would stamp it).
const foreignDeck = { id: 'd1', scope: 'private', ownerEmail: 'owner@example.com' };

describe('unrestricted auth-off operator', () => {
  it('isUnrestricted only trips on the explicit flag', () => {
    assert.strictEqual(isUnrestricted(OPERATOR), true);
    assert.strictEqual(isUnrestricted(OTHER), false);
    assert.strictEqual(isUnrestricted({ isAdmin: true }), false);
    assert.strictEqual(isUnrestricted(null), false);
  });

  it('grants read/write/delete/comment on a foreign private deck', () => {
    assert.strictEqual(canReadPresentation({ user: OPERATOR, pres: foreignDeck }), true);
    assert.strictEqual(canWritePresentation({ user: OPERATOR, pres: foreignDeck }), true);
    assert.strictEqual(canDeletePresentation({ user: OPERATOR, pres: foreignDeck }), true);
    assert.strictEqual(canCommentOnPresentation({ user: OPERATOR, pres: foreignDeck }), true);
    assert.strictEqual(getEffectivePermission({ user: OPERATOR, pres: foreignDeck }), 'edit');
  });

  it('shows a foreign deck in the operator collection view', () => {
    assert.strictEqual(belongsInCollection({ user: OPERATOR, pres: foreignDeck }), true);
  });

  it('does NOT grant a normal user access to a foreign private deck', () => {
    assert.strictEqual(canReadPresentation({ user: OTHER, pres: foreignDeck }), false);
    assert.strictEqual(canWritePresentation({ user: OTHER, pres: foreignDeck }), false);
    assert.strictEqual(belongsInCollection({ user: OTHER, pres: foreignDeck }), false);
  });
});
