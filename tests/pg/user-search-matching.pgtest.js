/**
 * What `searchUsers` compares, against real PostgreSQL.
 *
 * The share modal's people picker types straight into this function, so what a
 * typed character *means* is decided here. Two things used to be wrong, both
 * the defect B388 names in `searchTags` (`server/storage/tags.js`): the query
 * was folded in JavaScript and then compared with `ILIKE`, which folds again —
 * two folders for one comparison — and it went into the pattern unescaped, so
 * a typed `%` or `_` was a wildcard instead of a letter.
 *
 * These cases need the real database because the disagreement *is* the
 * database's folding: JavaScript's `toLowerCase` and PostgreSQL's are
 * different functions, and no in-memory double can show that.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import { searchUsers } from '../../server/storage/users.js';

// The facade refuses to invent an organization, so the test states the one it
// acts in — see server/storage/scope.js.
const SCOPE = testScope();

/** Names chosen for what they do to a fold or a LIKE pattern, not for realism. */
const PEOPLE = [
  // U+0130: JavaScript lowercases it to `i` + a combining dot, PostgreSQL's
  // en_US.utf8 `lower()` to a bare `i`. Folding twice loses this person.
  { email: 'istanbul@example.com', name: 'İstanbul Reviewer' },
  { email: 'percent@example.com', name: '100% Pure' },
  { email: 'thousand@example.com', name: '1000 Ideas' },
  { email: 'under@example.com', name: 'a_b Reporter' },
  { email: 'plain@example.com', name: 'axb Reporter' },
];

pgDescribe('searchUsers matching (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'users', 'organizations');
    const orgId = await seedDefaultOrganization(db);
    await db
      .insertInto('users')
      .values(
        PEOPLE.map((person, i) => ({
          id: `99999999-9999-4999-8999-99999999900${i}`,
          organization_id: orgId,
          email: person.email,
          name: person.name,
          role: 'user',
        })),
      )
      .execute();
  });

  it('finds a name whose JavaScript fold differs from PostgreSQL’s', async () => {
    const hits = await searchUsers(SCOPE, 'İstanbul');
    assert.deepEqual(
      hits.map((u) => u.email),
      ['istanbul@example.com'],
      'a person is findable by their own name',
    );
    // And the fold still folds: a plainly-typed query finds them too.
    const folded = await searchUsers(SCOPE, 'istanbul');
    assert.deepEqual(
      folded.map((u) => u.email),
      ['istanbul@example.com'],
    );
  });

  it('treats a typed % or _ as a letter, not a wildcard', async () => {
    const percent = await searchUsers(SCOPE, '100%');
    assert.deepEqual(
      percent.map((u) => u.email),
      ['percent@example.com'],
    );

    const underscore = await searchUsers(SCOPE, 'a_');
    assert.deepEqual(
      underscore.map((u) => u.email),
      ['under@example.com'],
    );
  });

  it('excludes addresses through the same normalizer that wrote them', async () => {
    const all = await searchUsers(SCOPE, 'example.com');
    assert.equal(all.length, PEOPLE.length);

    // A caller may hand an address in any casing or padding; `normalizeEmail`
    // is what put the stored one there, so it is what reads this one back.
    const some = await searchUsers(SCOPE, 'example.com', {
      exclude: ['  Percent@Example.com ', ''],
    });
    assert.equal(
      some.some((u) => u.email === 'percent@example.com'),
      false,
    );
    assert.equal(
      some.length,
      PEOPLE.length - 1,
      'a blank entry drops out instead of voiding the whole NOT IN',
    );
  });
});
