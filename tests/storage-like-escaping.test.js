/**
 * `escapeLikePattern` — what a user-typed character means inside a LIKE pattern.
 *
 * The behaviour against a real database is pinned where it happens
 * (tests/pg/tags-storage.pgtest.js and tests/pg/user-search-matching.pgtest.js,
 * both B388). This file pins the rule itself, so the suite still says what the
 * helper promises when no PostgreSQL is around: the three characters LIKE
 * reads as syntax come back escaped, and nothing else is touched.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { escapeLikePattern } from '../server/storage/utils/index.js';

describe('escapeLikePattern', () => {
  it('escapes the three characters LIKE reads as syntax', () => {
    assert.equal(escapeLikePattern('100%'), '100\\%');
    assert.equal(escapeLikePattern('a_b'), 'a\\_b');
    assert.equal(escapeLikePattern('C:\\'), 'C:\\\\');
    // The escape character first, so `\%` means a literal backslash followed
    // by a literal percent — not an escaped percent.
    assert.equal(escapeLikePattern('\\%'), '\\\\\\%');
  });

  it('leaves everything else exactly as typed', () => {
    for (const value of [
      'Sales',
      'İstanbul',
      'a-b c',
      "o'brien",
      '100 ideas',
    ]) {
      assert.equal(escapeLikePattern(value), value);
    }
  });

  it('answers a string for the absent cases callers hand it', () => {
    assert.equal(escapeLikePattern(''), '');
    assert.equal(escapeLikePattern(null), '');
    assert.equal(escapeLikePattern(undefined), '');
  });
});
