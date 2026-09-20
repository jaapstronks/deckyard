/**
 * B370 — the tag writer against the database that has to carry the names.
 *
 * The companion of tests/tag-name-contract.test.js, which pins the wire shape
 * on the two routes that refuse before any query. What needs a real PostgreSQL
 * is the half the contract cannot state on its own:
 *
 *   - **the fold.** `idx_tags_org_name` is unique on
 *     `(organization_id, lower(name))`, and that `lower()` is PostgreSQL's:
 *     it folds `'İ'` to a plain `i`, where JavaScript's folds it to `i` plus a
 *     combining dot. The writer used to deduplicate with the JavaScript fold,
 *     so `['i', 'İ']` passed as two names and then collided in the database —
 *     a 23505 the client saw as a 500. The list is deduplicated on the tag the
 *     database resolved instead, so the two are one tag and the write stands.
 *   - **the NUL byte**, which PostgreSQL refuses outright (22021). The test
 *     asserts the refusal arrives as an `invalid` result, which is only
 *     meaningful if the statement would otherwise have reached the database.
 *   - **the library shelf**, whose refusal lands after the item read and its
 *     ACL (D184 keeps the selection with the caller), so it needs a real row.
 *
 * Run with: DATABASE_URL=… npm run test:pg
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
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPersonalLibraryItem,
  setTagsForSlideLibraryItem,
} from '../../server/storage/slide-library.js';
import {
  createTag,
  getTagsForPresentation,
  listTags,
  setTagsForPresentation,
} from '../../server/storage/tags.js';

const storageScope = testScope();
const OWNER = 'owner@example.com';

/** Capital I with dot above: PostgreSQL lowers it to `i`, JavaScript does not. */
const DOTTED_I = 'İ';
/** A literal NUL, built rather than typed: it is invisible in a source file. */
const NUL = String.fromCharCode(0);

pgDescribe('what a tag may be called (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let libraryItem;
  let presentationId;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(
      db,
      'slide_library',
      'presentations',
      'tags',
      'users',
      'organizations',
    );
    await seedDefaultOrganization(db);
    libraryItem = (
      await createPersonalLibraryItem(
        storageScope,
        OWNER,
        { name: 'Mine', slideType: 'content-slide', content: {} },
        { actorEmail: OWNER },
      )
    ).item;
    presentationId = await seedPresentation(db);
  });

  it('folds two names to one tag the way the database does', async () => {
    const r = await setTagsForPresentation(storageScope, presentationId, [
      'i',
      DOTTED_I,
    ]);
    assert.equal(r.ok, true, 'the write stands instead of crashing on 23505');
    assert.equal(r.tags.length, 1, 'the database says these are one tag');
    assert.deepEqual(
      (await getTagsForPresentation(storageScope, presentationId)).map(
        (t) => t.name,
      ),
      ['i'],
      'the row carries one link, under the name that got there first',
    );
  });

  it('folds the same pair in the other order', async () => {
    const r = await setTagsForPresentation(storageScope, presentationId, [
      DOTTED_I,
      'i',
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(
      (await getTagsForPresentation(storageScope, presentationId)).map(
        (t) => t.name,
      ),
      [DOTTED_I],
    );
    assert.equal(
      (await listTags(storageScope)).length,
      1,
      'and only one tag row exists for the pair',
    );
  });

  it('refuses a NUL byte instead of letting PostgreSQL answer 22021', async () => {
    const r = await setTagsForPresentation(storageScope, presentationId, [
      `bad${NUL}name`,
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid');
    assert.equal(r.field, 'tags');
    assert.equal(r.fieldProblem.code, 'control_character');
  });

  it('leaves the existing tags alone when a later name is refused', async () => {
    await setTagsForPresentation(storageScope, presentationId, ['keeper']);
    const r = await setTagsForPresentation(storageScope, presentationId, [
      'replacement',
      '   ',
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.fieldProblem.code, 'blank');
    assert.equal(r.fieldProblem.index, 1);
    assert.deepEqual(
      (await getTagsForPresentation(storageScope, presentationId)).map(
        (t) => t.name,
      ),
      ['keeper'],
      'nothing was deleted on the way to the refusal',
    );
  });

  it('refuses the same names on the library shelf, after the item is found', async () => {
    const r = await setTagsForSlideLibraryItem(
      storageScope,
      { id: libraryItem.id, shelf: libraryItem.shelf },
      ['x'.repeat(101)],
      { actorEmail: OWNER },
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid');
    assert.equal(r.field, 'tags');
    assert.equal(r.fieldProblem.code, 'too_long');

    const missing = await setTagsForSlideLibraryItem(
      storageScope,
      { id: libraryItem.id, shelf: 'organization' },
      ['fine'],
      { actorEmail: OWNER },
    );
    assert.equal(missing.ok, false);
    assert.equal(
      missing.reason,
      'not_found',
      'the selection still answers before the names are judged',
    );
  });

  it('creates a tag through the same contract', async () => {
    const refused = await createTag(storageScope, '  ');
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'invalid');
    assert.equal(refused.field, 'name');
    assert.equal(refused.fieldProblem.code, 'blank');
    assert.equal(refused.fieldProblem.index, undefined);

    const made = await createTag(storageScope, '  Engineering  ');
    assert.equal(made.ok, true);
    assert.equal(made.tag.name, 'Engineering', 'padding is normalized away');

    const again = await createTag(storageScope, 'ENGINEERING');
    assert.equal(again.ok, true);
    assert.equal(again.tag.id, made.tag.id, 'one tag, the database folds it');
  });
});
