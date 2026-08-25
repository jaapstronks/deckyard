/**
 * The presentations facade under MULTI_ORG_ENABLED (A1 follow-up).
 *
 * This is the file that holds the bug the scope work exists to remove. Before
 * it, `server/storage/presentations/index.js` built its own context with a hardcoded
 * `getDefaultOrganizationId()`, so a session working in organization Beta that
 * asked the facade for a deck got an answer computed against organization
 * Alpha. Phase 2 (#359) caught the consequence fail-closed at the authorization
 * layer, which is why this was never an open leak — but the layer underneath
 * was still answering the wrong question.
 *
 * **Which assertions fail without the change** — verified by restoring the old
 * `getStorageContext()` in the facade, at which point exactly these four go red:
 *
 *   - "Beta's session does not see Alpha's deck through the facade"
 *   - "Beta's session sees Beta's deck, which the old default-organization read never would"
 *   - "a listing is confined to the session's organization"
 *   - "a public token still reaches its deck across organizations"
 *
 * The two that stay green are the ones the old behaviour got right by accident:
 * Alpha *is* the default organization here, so a read hardcoded to the default
 * answered correctly for Alpha and only for Alpha. That is the whole shape of
 * the bug — invisible on a single-organization instance, wrong on any other.
 *
 * MULTI_ORG_ENABLED is read at module scope (server/config/features.js),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/storage-scope-multi-org.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MULTI_ORG_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
// Postgres mode + the in-memory database double, so the assertions below run
// through the real facade rather than the adapter it delegates to. Driving the
// adapter directly would prove nothing here: the adapter always scoped its
// queries correctly; the facade was the layer that handed it the wrong
// organization.
process.env.STORAGE_MODE = 'postgres';

const ORG_A = process.env.DEFAULT_ORGANIZATION_ID;
const ORG_B = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { isMultiOrgEnabled } = await import('../server/config/features.js');
const { crossOrganizationScope, singleOrganizationScope } =
  await import('../server/storage/scope.js');
const facade = await import('../server/storage/presentations/index.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');

test.before(async () => {
  assert.equal(
    isMultiOrgEnabled(),
    true,
    'multi-organization flag is on for this file',
  );
  __setTestDb(
    createFakeDb({
      organizations: [
        { id: ORG_A, name: 'Alpha', slug: 'alpha' },
        { id: ORG_B, name: 'Beta', slug: 'beta' },
      ],
      presentations: [
        deckRow({ id: 'deck-alpha', org: ORG_A }),
        deckRow({ id: 'deck-beta', org: ORG_B }),
      ],
      // PR 2: the same question for the seven small facades. One row per
      // organization per table, so "did the facade filter on the session's
      // organization" has a visibly different answer per organization.
      published_presentations: [
        publishedRow({ id: 'pub-alpha', deck: 'deck-alpha', org: ORG_A }),
        publishedRow({ id: 'pub-beta', deck: 'deck-beta', org: ORG_B }),
      ],
      image_library: [
        imageRow({ id: 'img-alpha', org: ORG_A }),
        imageRow({ id: 'img-beta', org: ORG_B }),
      ],
      slide_library: [
        libraryRow({ id: 'lib-alpha', org: ORG_A }),
        libraryRow({ id: 'lib-beta', org: ORG_B }),
      ],
      slide_collections: [
        collectionRow({ id: 'col-alpha', org: ORG_A }),
        collectionRow({ id: 'col-beta', org: ORG_B }),
      ],
      slide_collection_items: [],
      tags: [
        { id: 'tag-alpha', organization_id: ORG_A, name: 'alpha-tag' },
        { id: 'tag-beta', organization_id: ORG_B, name: 'beta-tag' },
      ],
      presentation_tags: [
        { presentation_id: 'deck-alpha', tag_id: 'tag-alpha' },
        { presentation_id: 'deck-beta', tag_id: 'tag-beta' },
      ],
    }),
  );
  await initializeStorage('/srv/deckyard');
});

function deckRow({ id, org }) {
  return {
    id,
    organization_id: org,
    title: id,
    owner_email: 'carol@example.com',
    created_by: 'carol@example.com',
    updated_by: 'carol@example.com',
    visibility: 'organization',
    theme: 'default',
    lang: 'nl',
    revision: 1,
    slides: [],
    i18n: null,
    settings: {},
    is_view_only: false,
    trashed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    modified_at: '2026-01-01T00:00:00.000Z',
  };
}

function publishedRow({ id, deck, org }) {
  return {
    id,
    organization_id: org,
    presentation_id: deck,
    title: deck,
    slug: deck,
    og_image_url: '',
    created_at: '2026-01-01T00:00:00.000Z',
    modified_at: '2026-01-01T00:00:00.000Z',
  };
}

function imageRow({ id, org }) {
  return {
    id,
    organization_id: org,
    url: `/uploads/${id}.png`,
    title: id,
    description: '',
    photographer: '',
    tags: [],
    alts: {},
    sources: [],
    uploaded_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function libraryRow({ id, org }) {
  return {
    id,
    organization_id: org,
    shelf: 'organization',
    owner_email: null,
    name: id,
    description: '',
    slide_type: 'title-slide',
    theme_id: null,
    content: {},
    i18n: {},
    favorites: [],
    trashed_at: null,
    trashed_by: null,
    created_by: 'carol@example.com',
    updated_by: 'carol@example.com',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function collectionRow({ id, org }) {
  return {
    id,
    organization_id: org,
    shelf: 'organization',
    owner_email: null,
    name: id,
    description: '',
    created_by: 'carol@example.com',
    updated_by: 'carol@example.com',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

// ─── the bug, gone ─────────────────────────────────────────────────────────

test("Beta's session does not see Alpha's deck through the facade", async () => {
  const pres = await facade.getPresentation(
    { organizationId: ORG_B },
    'deck-alpha',
  );
  assert.equal(
    pres,
    null,
    'the deck lives in Alpha; a session working in Beta must not receive it',
  );
});

test("Alpha's session sees its own deck", async () => {
  const pres = await facade.getPresentation(
    { organizationId: ORG_A },
    'deck-alpha',
  );
  assert.equal(pres?.id, 'deck-alpha');
});

test("Beta's session sees Beta's deck, which the old default-organization read never would", async () => {
  const pres = await facade.getPresentation(
    { organizationId: ORG_B },
    'deck-beta',
  );
  assert.equal(
    pres?.id,
    'deck-beta',
    'this is the read that used to come back empty: the facade looked in the default organization',
  );
});

test("a listing is confined to the session's organization", async () => {
  const alpha = await facade.listPresentations({ organizationId: ORG_A });
  const beta = await facade.listPresentations({ organizationId: ORG_B });
  assert.deepEqual(
    alpha.map((p) => p.id),
    ['deck-alpha'],
  );
  assert.deepEqual(
    beta.map((p) => p.id),
    ['deck-beta'],
  );
});

// ─── what must keep working ────────────────────────────────────────────────

test('a public token still reaches its deck across organizations', async () => {
  // A published deck, an embed and a share link resolve a globally unique token
  // first and fetch by the id it yielded. Filtering those on the session's
  // organization — there is no session — would 404 every public link.
  const scope = crossOrganizationScope(
    null,
    'published deck: the publish id is the authorization',
  );
  const alpha = await facade.getPresentation(scope, 'deck-alpha');
  const beta = await facade.getPresentation(scope, 'deck-beta');
  assert.equal(alpha?.id, 'deck-alpha');
  assert.equal(beta?.id, 'deck-beta');
});

test('the short-TTL read cache is keyed per organization', async () => {
  // presentation-cache.js sits in front of the facade on the audience hot paths.
  // A cache keyed on repo root alone would undo the isolation above inside its
  // 2s window: Beta asks for 'deck-alpha' and gets Alpha's entry back.
  const { getPresentationCached } =
    await import('../server/storage/presentations/cache.js');

  const alpha = await getPresentationCached(
    { repoRoot: '/srv', organizationId: ORG_A },
    'deck-alpha',
  );
  assert.equal(alpha?.id, 'deck-alpha');

  const beta = await getPresentationCached(
    { repoRoot: '/srv', organizationId: ORG_B },
    'deck-alpha',
  );
  assert.equal(
    beta,
    null,
    'Beta must miss the cache entry Alpha just filled, not inherit it',
  );
});

test('an entry point with no organization refuses to guess once there are several', () => {
  assert.throws(
    () => singleOrganizationScope('/srv', 'MCP stdio session'),
    /has no organization to act in, and this instance runs several/,
    'on a multi-organization instance "the default one" stops being an answer',
  );
});

// ─── PR 2: the same isolation for the seven small facades ───────────────────
//
// Each of these used to read the default organization (Alpha here) regardless of
// the session. Every assertion below that names Beta is one the old
// `getStorageContext()` got wrong: it either handed Beta Alpha's rows or told
// Beta its own rows did not exist.

test('the published index is per organization', async () => {
  const { getPublishedIndex } = await import('../server/storage/published.js');
  const alpha = await getPublishedIndex({ organizationId: ORG_A });
  const beta = await getPublishedIndex({ organizationId: ORG_B });
  assert.deepEqual(Object.keys(alpha), ['pub-alpha']);
  assert.deepEqual(
    Object.keys(beta),
    ['pub-beta'],
    "Beta used to be handed Alpha's publish index",
  );
});

test('a publish id still resolves across organizations, because it is the token', async () => {
  const { getPublishedById } = await import('../server/storage/published.js');
  const scope = crossOrganizationScope(
    null,
    'published deck: the publish id is the authorization',
  );
  const entry = await getPublishedById(scope, 'pub-beta');
  assert.equal(
    entry?.presentationId,
    'deck-beta',
    'a public link must work from any organization',
  );
});

test('the image library is per organization', async () => {
  const { listImageLibrary, getImageLibraryItem } =
    await import('../server/storage/image-library.js');
  const alpha = await listImageLibrary({ organizationId: ORG_A });
  const beta = await listImageLibrary({ organizationId: ORG_B });
  assert.deepEqual(
    alpha.map((i) => i.id),
    ['img-alpha'],
  );
  assert.deepEqual(
    beta.map((i) => i.id),
    ['img-beta'],
  );
  assert.equal(
    await getImageLibraryItem({ organizationId: ORG_B }, 'img-alpha'),
    null,
    "Beta must not reach Alpha's image by id",
  );
});

test('the team slide library is per organization', async () => {
  const { listOrganizationLibrary, getOrganizationLibraryItem } =
    await import('../server/storage/slide-library.js');
  const { items: alpha } = await listOrganizationLibrary({
    organizationId: ORG_A,
  });
  const { items: beta } = await listOrganizationLibrary({
    organizationId: ORG_B,
  });
  assert.deepEqual(
    alpha.map((i) => i.id),
    ['lib-alpha'],
  );
  assert.deepEqual(
    beta.map((i) => i.id),
    ['lib-beta'],
  );
  assert.equal(
    (await getOrganizationLibraryItem({ organizationId: ORG_A }, 'lib-alpha'))
      ?.id,
    'lib-alpha',
    'a team item resolves on its own shelf (the shelf axis is item.shelf)',
  );
  assert.equal(
    await getOrganizationLibraryItem({ organizationId: ORG_B }, 'lib-alpha'),
    null,
    "a team shelf is an organization's own shelf",
  );
});

test('team collections are per organization', async () => {
  const { listOrganizationCollections } =
    await import('../server/storage/collections.js');
  const { items: alpha } = await listOrganizationCollections({
    organizationId: ORG_A,
  });
  const { items: beta } = await listOrganizationCollections({
    organizationId: ORG_B,
  });
  assert.deepEqual(
    alpha.map((c) => c.id),
    ['col-alpha'],
  );
  assert.deepEqual(
    beta.map((c) => c.id),
    ['col-beta'],
  );
});

test('tags are per organization', async () => {
  // `listTags` would be the obvious probe, but its query groups to compute usage
  // counts and the database double has no GROUP BY. The per-deck lookup exercises
  // the same organization filter on the same tables.
  const { getTagsForPresentation } = await import('../server/storage/tags.js');

  assert.deepEqual(
    (await getTagsForPresentation({ organizationId: ORG_A }, 'deck-alpha')).map(
      (t) => t.name,
    ),
    ['alpha-tag'],
  );
  assert.deepEqual(
    (await getTagsForPresentation({ organizationId: ORG_B }, 'deck-beta')).map(
      (t) => t.name,
    ),
    ['beta-tag'],
    "Beta's own tags used to come back empty: the lookup filtered on the default organization",
  );
  assert.deepEqual(
    await getTagsForPresentation({ organizationId: ORG_B }, 'deck-alpha'),
    [],
    "and Alpha's tag vocabulary must not leak into Beta",
  );
});
