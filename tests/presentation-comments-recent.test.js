/**
 * Smoke/contract tests for the cross-deck comment read helper
 * `listRecentCommentsOnDecks`.
 *
 * The assertions here are the ones that hold whatever the comment store holds:
 * no decks means no comments, a missing scope throws, and odd inputs (bad
 * status, oversized limit) never throw. Which decks are read is the comment
 * service's choice (`listRecentComments`, B618), pinned in
 * tests/service-layer-b618.test.js.
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
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { listRecentCommentsOnDecks } =
  await import('../server/storage/presentations/comments.js');

// A deck id no comment row points at, in any environment.
const NO_COMMENTS = [{ id: 'd0000000-0000-4000-8000-0000000000ff' }];

// A storage scope states the organization it acts in; the helper refuses one
// that does not.
const ORG = { organizationId: ORG_ID };

before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG_ID, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});

after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

describe('listRecentCommentsOnDecks', () => {
  it('returns an empty result for no decks', async () => {
    for (const decks of [[], null, undefined]) {
      assert.deepStrictEqual(
        await listRecentCommentsOnDecks({ ...ORG }, decks),
        {
          comments: [],
          total: 0,
        },
      );
    }
  });

  it('throws on a missing scope', async () => {
    await assert.rejects(listRecentCommentsOnDecks(null, []), TypeError);
  });

  it('returns an empty result for decks without comments', async () => {
    const result = await listRecentCommentsOnDecks({ ...ORG }, NO_COMMENTS);
    assert.deepStrictEqual(result, { comments: [], total: 0 });
  });

  it('tolerates odd options (bad status, oversized limit) without throwing', async () => {
    const result = await listRecentCommentsOnDecks({ ...ORG }, NO_COMMENTS, {
      status: 'weird',
      limit: 100000,
      authorEmail: 'x@y.z',
    });
    assert.deepStrictEqual(result, { comments: [], total: 0 });
  });
});
