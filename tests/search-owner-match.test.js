/**
 * Deck search matches the owner by `ownerEmail` (B461), in the server's
 * `/api/presentations/search`, which Home's search view asks since the deck
 * list is paged (B821). The list projection carries no owner display name, so
 * search does not read `ownerName`; a stale one riding along must not make a
 * deck match.
 *
 * Run with: node --test tests/search-owner-match.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { metadataMatchLocations } from '../server/services/deck-search.js';

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

test('search does not match on an ownerName the list never projects', () => {
  const stale = { ...DECK, ownerName: 'Zebedeus' };
  assert.deepEqual(metadataMatchLocations(stale, 'zebedeus'), []);
});

test('title and description still match', () => {
  assert.deepEqual(metadataMatchLocations(DECK, 'quarterly'), ['title']);
  assert.deepEqual(metadataMatchLocations(DECK, 'numbers'), ['description']);
  assert.deepEqual(metadataMatchLocations(DECK, 'nothing-like-it'), []);
});
