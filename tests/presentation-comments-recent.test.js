/**
 * Smoke/contract tests for the cross-deck comment read helpers:
 * `listAccessiblePresentationRefs` and `listRecentCommentsForOwner`.
 *
 * These run without a database: comments live only in the DB store, so the
 * meaningful assertions here are the ones that hold in every mode — an unknown
 * or missing owner resolves to no accessible decks and therefore no comments,
 * and odd inputs (bad scope/status, oversized limit) never throw. The DB-backed
 * behaviour (ordering, author filter, limit, owned+shared union, title
 * enrichment) needs a live Postgres and is exercised as a local integration
 * step, matching this repo's "integration tests need DB access" boundary.
 *
 * Run with: node --test tests/presentation-comments-recent.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { repoRoot } from '../server/config/paths.js';
import {
  listAccessiblePresentationRefs,
  listRecentCommentsForOwner,
} from '../server/storage/presentation-comments.js';

// An address that owns no decks and is shared none, in any environment.
const NOBODY = 'nobody-xyz@example.invalid';

describe('listAccessiblePresentationRefs', () => {
  it('returns [] when there is no acting owner', async () => {
    assert.deepStrictEqual(await listAccessiblePresentationRefs(repoRoot, {}, 'all'), []);
    assert.deepStrictEqual(await listAccessiblePresentationRefs(repoRoot, null, 'all'), []);
  });

  it('returns [] for an owner with no owned or shared decks', async () => {
    const refs = await listAccessiblePresentationRefs(repoRoot, { actorEmail: NOBODY }, 'all');
    assert.deepStrictEqual(refs, []);
  });

  it('accepts every scope without throwing', async () => {
    for (const scope of ['owned', 'shared', 'all', 'bogus']) {
      const refs = await listAccessiblePresentationRefs(repoRoot, { actorEmail: NOBODY }, scope);
      assert.ok(Array.isArray(refs), `scope ${scope} should return an array`);
    }
  });
});

describe('listRecentCommentsForOwner', () => {
  it('returns an empty result when there is no acting owner', async () => {
    assert.deepStrictEqual(await listRecentCommentsForOwner(repoRoot, {}), {
      comments: [],
      total: 0,
    });
  });

  it('returns an empty result for an owner with no accessible decks', async () => {
    const result = await listRecentCommentsForOwner(repoRoot, { actorEmail: NOBODY });
    assert.deepStrictEqual(result, { comments: [], total: 0 });
  });

  it('tolerates odd options (bad scope/status, oversized limit) without throwing', async () => {
    const result = await listRecentCommentsForOwner(
      repoRoot,
      { actorEmail: NOBODY },
      { scope: 'nonsense', status: 'weird', limit: 100000, authorEmail: 'x@y.z' }
    );
    assert.deepStrictEqual(result, { comments: [], total: 0 });
  });
});
