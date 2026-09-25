import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { createFakeDb } from './helpers/fake-db.js';
import { testScope } from './helpers/storage-scope.js';
import { __setTestDb } from '../server/db/client.js';
import { buildFeed } from '../server/utils/rss-feed.js';
import { resolveOgAuthor } from '../server/services/publish-presentation.js';
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
    title: 'A published deck',
    description: 'desc',
    modified: '2026-07-21T10:00:00.000Z',
    created: '2026-07-20T10:00:00.000Z',
    published: {
      id: 'pub123',
      slug: 'a-deck',
      created: '2026-07-20T10:00:00.000Z',
    },
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
      presentations: [
        feedEntry({ ownerEmail: 'jaap@ciiic.nl', ownerName: 'jaap' }),
      ],
    });
    assert.ok(!out.includes('ciiic.nl'), 'email domain leaked into the feed');
    assert.ok(!/\bjaap\b/.test(out), 'email local-part leaked into the feed');
    assert.ok(!out.includes('<author'), 'no author element expected');
    assert.ok(!out.includes('"author'), 'no JSON author expected');
  });
}

// No public surface derives a name from an email address: the feed enrichment,
// the feed builder and the og-card author (B462). Private surfaces (digest
// mail, the editor top bar) are not scanned.
const PUBLIC_SOURCES = [
  'server/storage/published.js',
  'server/utils/rss-feed.js',
  'server/services/publish-presentation.js',
];
for (const rel of PUBLIC_SOURCES) {
  test(`${rel} derives nothing from an email address`, () => {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    assert.ok(!src.includes(".split('@')"), `${rel} splits an email address`);
    assert.ok(!/\bownerName\b/.test(src), `${rel} reads or writes ownerName`);
  });
}

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_ORG = '00000000-0000-0000-0000-0000000000aa';

function seedProfiles(profile) {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }],
      users: [
        {
          id: OWNER_ID,
          organization_id: DEFAULT_ORG,
          email: 'jaap@ciiic.nl',
          name: null,
        },
      ],
      user_settings: profile
        ? [{ user_id: OWNER_ID, email: 'jaap@ciiic.nl', settings: { profile } }]
        : [],
    }),
  );
}

test('the og-card author is the profile name', async () => {
  seedProfiles({ name: 'Jaap Stronks', imageUrl: '/media/jaap.png' });
  try {
    assert.deepEqual(await resolveOgAuthor(testScope(), 'jaap@ciiic.nl'), {
      name: 'Jaap Stronks',
      imageUrl: '/media/jaap.png',
    });
  } finally {
    __setTestDb(null);
  }
});

test('without a profile name the og card has no author block', async () => {
  for (const profile of [
    null,
    { name: '' },
    { name: '   ', imageUrl: '/x.png' },
  ]) {
    seedProfiles(profile);
    try {
      assert.equal(await resolveOgAuthor(testScope(), 'jaap@ciiic.nl'), null);
    } finally {
      __setTestDb(null);
    }
  }
  assert.equal(await resolveOgAuthor(testScope(), null), null);
});

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
