import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeed } from '../server/utils/rss-feed.js';
import { sanitizePresentation } from '../server/routes/public-api/v1/presentations.js';

/**
 * Datamodel-purity move 3 (narrow leak fix): the owner's raw email must not
 * leak into public-facing surfaces. Full email -> user-id decoupling is a
 * separate epic (docs/plans/identity-decoupling.md).
 */

const ORG = { title: 'Test org', description: 'Decks', logoUrl: '' };
const BASE = 'https://example.com';

function feedEntry(extra = {}) {
  return {
    title: 'A published deck',
    description: 'desc',
    modified: '2026-07-21T10:00:00.000Z',
    created: '2026-07-20T10:00:00.000Z',
    published: { id: 'pub123', slug: 'a-deck', created: '2026-07-20T10:00:00.000Z' },
    ...extra,
  };
}

test('the RSS feed never publishes the owner raw email address', () => {
  // Even if a leftover ownerEmail rides along on the entry, the builder must
  // only read the display handle - the raw address must not appear anywhere.
  const xml = buildFeed({
    org: ORG,
    baseUrl: BASE,
    format: 'rss',
    presentations: [feedEntry({ ownerName: 'jaap', ownerEmail: 'jaap@ciiic.nl' })],
  });
  assert.ok(!xml.includes('jaap@ciiic.nl'), 'raw email leaked into the feed');
  assert.ok(!xml.includes('@ciiic.nl'), 'email domain leaked into the feed');
  assert.ok(xml.includes('jaap'), 'display handle attribution should remain');
});

test('a feed entry without a display handle emits no author', () => {
  const xml = buildFeed({
    org: ORG,
    baseUrl: BASE,
    format: 'atom',
    presentations: [feedEntry({ ownerName: '' })],
  });
  assert.ok(!xml.includes('<author'), 'no author element expected');
});

test('public API returns the owner email only to the owner', () => {
  const pres = {
    id: 'p1',
    title: 'Deck',
    ownerEmail: 'owner@example.com',
    scope: 'workspace',
    slides: [],
  };

  // The owner sees their own email.
  const asOwner = sanitizePresentation(pres, [], 'owner@example.com');
  assert.equal(asOwner.ownerEmail, 'owner@example.com');

  // Case-insensitive match still counts as self.
  const asOwnerCased = sanitizePresentation(pres, [], 'Owner@Example.com');
  assert.equal(asOwnerCased.ownerEmail, 'owner@example.com');

  // A different requester (workspace/collaborator access) gets null.
  const asOther = sanitizePresentation(pres, [], 'someone-else@example.com');
  assert.equal(asOther.ownerEmail, null);

  // No requester context -> redacted.
  const anon = sanitizePresentation(pres, []);
  assert.equal(anon.ownerEmail, null);
});
