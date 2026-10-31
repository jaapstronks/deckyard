import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { buildFeed } from '../server/utils/rss-feed.js';
import { sanitizePresentation } from '../server/routes/public-api/v1/presentations.js';

/**
 * Datamodel-purity move 3 (narrow leak fix): the owner's raw email must not
 * leak into public-facing surfaces. Full email -> user-id decoupling is a
 * separate epic (docs/plans/briefs/identity-decoupling.md).
 */

const ORG = { title: 'Test org', description: 'Decks', logoUrl: '' };
const BASE = 'https://example.com';

function feedEntry(extra = {}) {
  return {
    id: 'e0000001-0000-4000-8000-000000000001',
    publicationId: 'e0000002-0000-4000-8000-000000000002',
    version: 1,
    publishedAt: '2026-07-20T10:00:00.000Z',
    title: 'A published deck',
    description: 'desc',
    ...extra,
  };
}

// B462: the feed carries no per-item author at all. A display handle cut from
// the email (the local-part) was the old attribution; it is still derived from
// the address, so it went too. A real display name arrives with identity
// decoupling.
for (const format of ['rss', 'atom', 'json']) {
  test(`the ${format} feed names no author, not even an email local-part`, () => {
    const out = buildFeed({
      org: ORG,
      baseUrl: BASE,
      format,
      // A leftover handle riding along on the entry is not read either.
      editions: [feedEntry({ ownerEmail: 'jaap@ciiic.nl', ownerName: 'jaap' })],
    });
    assert.ok(!out.includes('ciiic.nl'), 'email domain leaked into the feed');
    assert.ok(!/\bjaap\b/.test(out), 'email local-part leaked into the feed');
    assert.ok(!out.includes('<author'), 'no author element expected');
    assert.ok(!out.includes('"author'), 'no JSON author expected');
  });
}

// No public surface derives a name from an email address: the feed, its
// listing and the edition read path (B462). An edition's preview is its own
// first image, so there is no og-card author any more (T1.5). Private surfaces
// (digest mail, the editor top bar) are not scanned.
const PUBLIC_SOURCES = [
  'server/routes/feed.js',
  'server/utils/rss-feed.js',
  'server/services/public-edition.js',
  'server/routes/static/edition.js',
];
for (const rel of PUBLIC_SOURCES) {
  test(`${rel} derives nothing from an email address`, () => {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    assert.ok(!src.includes(".split('@')"), `${rel} splits an email address`);
    assert.ok(!/\bownerName\b/.test(src), `${rel} reads or writes ownerName`);
  });
}

test('public API returns the owner email only to the owner', () => {
  const pres = {
    id: 'p1',
    title: 'Deck',
    ownerEmail: 'owner@example.com',
    visibility: 'organization',
    slides: [],
  };

  // The owner sees their own email.
  const asOwner = sanitizePresentation(pres, [], 'owner@example.com');
  assert.equal(asOwner.ownerEmail, 'owner@example.com');

  // Case-insensitive match still counts as self.
  const asOwnerCased = sanitizePresentation(pres, [], 'Owner@Example.com');
  assert.equal(asOwnerCased.ownerEmail, 'owner@example.com');

  // A different requester (organization/collaborator access) gets null.
  const asOther = sanitizePresentation(pres, [], 'someone-else@example.com');
  assert.equal(asOther.ownerEmail, null);

  // No requester context -> redacted.
  const anon = sanitizePresentation(pres, []);
  assert.equal(anon.ownerEmail, null);
});
