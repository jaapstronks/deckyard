/**
 * Tags storage against real PostgreSQL, through the storage facade.
 *
 * The PostgreSQL counterpart of tests/tags-storage.test.js (which drove the
 * same `server/storage/tags/index.js` facade against the file adapter). This is
 * the coverage that must survive the file adapter's removal (PR G): the tag
 * round-trip the editor and list views depend on —
 * - set/get tags for a presentation (case-insensitive dedup, blank drop)
 * - a shared tag id across presentations by name
 * - bulk fetch (list views)
 * - org-wide list with usage counts
 * - create + delete (delete strips the tag from every link)
 * - prefix search
 *
 * Unlike the file suite, a presentation id here is a real `presentations.id`
 * uuid — `presentation_tags.presentation_id` is a NOT NULL foreign key — so the
 * test seeds real rows and threads their ids, instead of the `'p1'` literals
 * the file backend tolerated.
 */

import { after, before, it } from 'node:test';
import assert from 'node:assert';

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
  listTags,
  getTagsForPresentation,
  getTagsForPresentations,
  setTagsForPresentation,
  createTag,
  deleteTag,
  searchTags,
} from '../../server/storage/tags/index.js';
import crypto from 'node:crypto';

// The facade refuses to invent an organization, so the test states the one it
// acts in — see server/storage/scope.js.
const storageScope = testScope();

pgDescribe('tags storage (real PostgreSQL, via facade)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  // Real presentation-uuid stand-ins for the file suite's 'p1'/'p2'/'p3'.
  let p1;
  let p2;
  let p3;
  const missing = crypto.randomUUID(); // valid uuid, never seeded

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    p1 = await seedPresentation(db, { title: 'P1' });
    p2 = await seedPresentation(db, { title: 'P2' });
    p3 = await seedPresentation(db, { title: 'P3' });
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  it('reads back empty on a fresh store instead of throwing', async () => {
    assert.deepStrictEqual(await listTags(storageScope), []);
    assert.deepStrictEqual(
      await getTagsForPresentation(storageScope, missing),
      [],
    );
    const map = await getTagsForPresentations(storageScope, [p1, p2]);
    assert.ok(map instanceof Map);
    assert.strictEqual(map.size, 0);
  });

  it('sets and gets tags for a presentation (sorted, deduped)', async () => {
    const set = await setTagsForPresentation(storageScope, p1, [
      'Sales',
      'sales',
      'Q3',
      '',
    ]);
    // 'sales' is a case-insensitive dup of 'Sales'; blank is dropped.
    assert.deepStrictEqual(set.map((t) => t.name).sort(), ['Q3', 'Sales']);

    const got = await getTagsForPresentation(storageScope, p1);
    assert.deepStrictEqual(
      got.map((t) => t.name),
      ['Q3', 'Sales'],
    ); // name-sorted
    assert.ok(got.every((t) => typeof t.id === 'string' && t.id.length > 0));
  });

  it('shares a tag id across presentations by name', async () => {
    await setTagsForPresentation(storageScope, p2, ['Sales', 'Marketing']);
    const got1 = await getTagsForPresentation(storageScope, p1);
    const got2 = await getTagsForPresentation(storageScope, p2);
    const salesP1 = got1.find((t) => t.name === 'Sales');
    const salesP2 = got2.find((t) => t.name === 'Sales');
    assert.strictEqual(salesP1.id, salesP2.id, 'same name → same id');
  });

  it('bulk-fetches tags for a list of presentations', async () => {
    const map = await getTagsForPresentations(storageScope, [p1, p2, missing]);
    assert.deepStrictEqual(
      map.get(p1).map((t) => t.name),
      ['Q3', 'Sales'],
    );
    assert.deepStrictEqual(
      map.get(p2).map((t) => t.name),
      ['Marketing', 'Sales'],
    );
    assert.strictEqual(map.has(missing), false);
  });

  it('lists all tags with usage counts', async () => {
    const all = await listTags(storageScope);
    const byName = Object.fromEntries(all.map((t) => [t.name, t.count]));
    assert.strictEqual(byName.Sales, 2); // p1 + p2
    assert.strictEqual(byName.Q3, 1);
    assert.strictEqual(byName.Marketing, 1);
  });

  it('replaces (not merges) tags on a subsequent set', async () => {
    await setTagsForPresentation(storageScope, p1, ['Q3']);
    const got = await getTagsForPresentation(storageScope, p1);
    assert.deepStrictEqual(
      got.map((t) => t.name),
      ['Q3'],
    );
    // Sales count drops to 1 (only p2 now).
    const all = await listTags(storageScope);
    assert.strictEqual(all.find((t) => t.name === 'Sales').count, 1);
  });

  it('clears tags when set to an empty list', async () => {
    await setTagsForPresentation(storageScope, p1, []);
    assert.deepStrictEqual(await getTagsForPresentation(storageScope, p1), []);
  });

  it('creates a standalone tag and finds it via prefix search', async () => {
    const created = await createTag(storageScope, 'Engineering');
    assert.strictEqual(created.name, 'Engineering');
    const hits = await searchTags(storageScope, 'eng');
    assert.ok(hits.some((t) => t.name === 'Engineering'));
    // Unused tag has a zero count.
    assert.strictEqual(hits.find((t) => t.name === 'Engineering').count, 0);
  });

  it('deletes a tag and strips it from every presentation link', async () => {
    await setTagsForPresentation(storageScope, p3, ['Marketing', 'Sales']);
    const salesId = (await getTagsForPresentation(storageScope, p3)).find(
      (t) => t.name === 'Sales',
    ).id;
    assert.strictEqual(await deleteTag(storageScope, salesId), true);

    assert.deepStrictEqual(
      (await getTagsForPresentation(storageScope, p2)).map((t) => t.name),
      ['Marketing'],
    );
    assert.deepStrictEqual(
      (await getTagsForPresentation(storageScope, p3)).map((t) => t.name),
      ['Marketing'],
    );
    assert.ok(!(await listTags(storageScope)).some((t) => t.name === 'Sales'));
    assert.strictEqual(
      await deleteTag(storageScope, salesId),
      false,
      'second delete is a no-op',
    );
  });
});
