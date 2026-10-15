/**
 * The share modal's ownership transfer finds the new owner by the address the
 * user types (B699). The typed address is folded once through
 * `normalizeEmail` (D200); the eligible collaborators' addresses come from the
 * server in that spelling and are compared bare.
 *
 * Run with: node --test tests/share-modal-owner-transfer.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { findEligibleOwner } from '../client/views/editor/modals/share-modal/utils.js';

const ELIGIBLE = [
  { userEmail: 'ann@example.com', permission: 'edit' },
  { userEmail: 'bob@example.com', permission: 'admin' },
];

test('a typed address in mixed case with spaces still finds the collaborator', () => {
  assert.equal(findEligibleOwner(ELIGIBLE, '  Bob@Example.COM '), ELIGIBLE[1]);
});

test('an exact address finds the collaborator', () => {
  assert.equal(findEligibleOwner(ELIGIBLE, 'ann@example.com'), ELIGIBLE[0]);
});

test('an address outside the eligible list finds nobody', () => {
  assert.equal(findEligibleOwner(ELIGIBLE, 'carol@example.com'), null);
});

test('blank input finds nobody', () => {
  assert.equal(findEligibleOwner(ELIGIBLE, '   '), null);
  assert.equal(findEligibleOwner(ELIGIBLE, ''), null);
});
