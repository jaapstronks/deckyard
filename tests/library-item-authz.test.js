/**
 * Who may change a slide-library item (D170), the predicate behind the
 * library's write routes and the `canEdit` the deck editor's library lock
 * reads (B905, D368).
 *
 * Run with: node --test tests/library-item-authz.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canEditLibraryItem,
  canEditOrganizationItem,
} from '../server/utils/library-item-authz.js';

const MAKER = { id: 'u-maker', email: 'maker@example.com' };
const OTHER = { id: 'u-other', email: 'other@example.com' };
const ADMIN = { id: 'u-admin', email: 'admin@example.com', isAdmin: true };

const orgItem = {
  shelf: 'organization',
  createdBy: { id: 'u-maker', displayName: 'Maker' },
};

test('an organization item is the maker’s and an admin’s to change', () => {
  assert.equal(canEditOrganizationItem(MAKER, orgItem), true);
  assert.equal(canEditOrganizationItem(ADMIN, orgItem), true);
  assert.equal(canEditOrganizationItem(OTHER, orgItem), false);
  assert.equal(canEditOrganizationItem(null, orgItem), false);
});

test('an item without a creator belongs to nobody but an admin', () => {
  const orphan = { shelf: 'organization', createdBy: null };
  assert.equal(canEditOrganizationItem(OTHER, orphan), false);
  assert.equal(canEditOrganizationItem(ADMIN, orphan), true);
});

test('a readable personal item is the reader’s own', () => {
  const personal = { shelf: 'personal', createdBy: { id: 'u-other' } };
  assert.equal(canEditLibraryItem(MAKER, personal), true);
  assert.equal(canEditLibraryItem(OTHER, orgItem), false);
  assert.equal(canEditLibraryItem(MAKER, orgItem), true);
});
