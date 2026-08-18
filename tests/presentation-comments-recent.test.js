/**
 * Smoke/contract tests for the cross-deck comment read helpers:
 * `listAccessiblePresentationRefs` and `listRecentCommentsForOwner`.
 *
 * The assertions here are the ones that hold whatever the comment store holds:
 * an unknown or missing owner resolves to no accessible decks and therefore no
 * comments, a missing scope throws, and odd inputs (bad ownership/status,
 * oversized limit) never throw. The richer behaviour (ordering, author filter,
 * limit, owned+shared union, title enrichment) needs a live Postgres and is
 * exercised as a local integration step, matching this repo's "integration
 * tests need DB access" boundary.
 *
 * The deck lookups these helpers do go through the presentations facade, so the
 * suite runs against the Postgres adapter on the in-memory database double
 * (tests/helpers/fake-db.js), seeded with no decks at all.
 *
 * Run with: node --test tests/presentation-comments-recent.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG_ID = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
// `__resetStorageForTests` rather than `closeStorage`: the double is not a real
// Kysely handle, so closing it would call a `destroy()` it does not have.
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/adapters/index.js'
);
const { listAccessiblePresentationRefs, listRecentCommentsForOwner } = await import(
  '../server/storage/presentations/comments.js'
);

// An address that owns no decks and is shared none, in any environment.
const NOBODY = 'nobody-xyz@example.invalid';

// A storage scope states the organization it acts in; these helpers reach the
// presentations facade, which no longer accepts one that does not.
const ORG = { organizationId: ORG_ID };

before(async () => {
  __setTestDb(
    createFakeDb({ organizations: [{ id: ORG_ID, name: 'Default', slug: 'default' }] })
  );
  await initializeStorage();
});

after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

describe('listAccessiblePresentationRefs', () => {
  it('returns [] when there is no acting owner', async () => {
    assert.deepStrictEqual(await listAccessiblePresentationRefs({ ...ORG }, 'all'), []);
  });

  it('throws on a missing scope', async () => {
    await assert.rejects(listAccessiblePresentationRefs(null, 'all'), TypeError);
  });

  it('returns [] for an owner with no owned or shared decks', async () => {
    const refs = await listAccessiblePresentationRefs({ ...ORG, actorEmail: NOBODY }, 'all');
    assert.deepStrictEqual(refs, []);
  });

  it('accepts every ownership value without throwing', async () => {
    for (const ownership of ['owned', 'shared', 'all', 'bogus']) {
      const refs = await listAccessiblePresentationRefs(
        { ...ORG, actorEmail: NOBODY },
        ownership
      );
      assert.ok(Array.isArray(refs), `ownership ${ownership} should return an array`);
    }
  });
});

describe('listRecentCommentsForOwner', () => {
  it('returns an empty result when there is no acting owner', async () => {
    assert.deepStrictEqual(await listRecentCommentsForOwner({ ...ORG }), {
      comments: [],
      total: 0,
    });
  });

  it('throws on a missing scope', async () => {
    await assert.rejects(listRecentCommentsForOwner(null), TypeError);
  });

  it('returns an empty result for an owner with no accessible decks', async () => {
    const result = await listRecentCommentsForOwner({ ...ORG, actorEmail: NOBODY });
    assert.deepStrictEqual(result, { comments: [], total: 0 });
  });

  it('tolerates odd options (bad ownership/status, oversized limit) without throwing', async () => {
    const result = await listRecentCommentsForOwner(
      { ...ORG, actorEmail: NOBODY },
      { ownership: 'nonsense', status: 'weird', limit: 100000, authorEmail: 'x@y.z' }
    );
    assert.deepStrictEqual(result, { comments: [], total: 0 });
  });
});
