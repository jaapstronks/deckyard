/**
 * B461: deck search matches the owner by `ownerEmail`, on both sides — the
 * server's `/api/presentations/search` and the client's list-side filter. The
 * list projection carries no owner display name, so neither side reads
 * `ownerName`; a stale one riding along must not make a deck match.
 *
 * Run with: node --test tests/search-owner-match.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { metadataMatchLocations } from '../server/routes/api/presentations/search.js';
import { matchesQuery } from '../client/views/list/views/search-view.js';

const DECK = {
  id: 'p1',
  title: 'Quarterly review',
  description: 'Numbers',
  ownerEmail: 'Jaap.Stronks@ciiic.nl',
  theme: 'default',
};

test('server search still finds a deck by its owner email address', () => {
  assert.deepEqual(metadataMatchLocations(DECK, 'jaap.stronks'), ['owner']);
  assert.deepEqual(metadataMatchLocations(DECK, 'ciiic.nl'), ['owner']);
});

test('client search still finds a deck by its owner email address', () => {
  assert.equal(matchesQuery(DECK, 'Jaap.Stronks'), true);
  assert.equal(matchesQuery(DECK, 'ciiic.nl'), true);
});

test('neither side matches on an ownerName the list never projects', () => {
  const stale = { ...DECK, ownerName: 'Zebedeus' };
  assert.deepEqual(metadataMatchLocations(stale, 'zebedeus'), []);
  assert.equal(matchesQuery(stale, 'zebedeus'), false);
});

test('title and description still match', () => {
  assert.deepEqual(metadataMatchLocations(DECK, 'quarterly'), ['title']);
  assert.deepEqual(metadataMatchLocations(DECK, 'numbers'), ['description']);
  assert.equal(matchesQuery(DECK, 'quarterly'), true);
  assert.equal(matchesQuery(DECK, 'nothing-like-it'), false);
});
