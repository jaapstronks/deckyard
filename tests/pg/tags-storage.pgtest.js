/**
 * Tags storage against real PostgreSQL, through the storage facade.
 *
 * The PostgreSQL counterpart of tests/tags-storage.test.js (which drove the
 * same `server/storage/tags.js` facade against the file adapter). This is
 * the coverage that must survive the file adapter's removal (PR G): the tag
 * round-trip the editor and list views depend on —
 * - set/get tags for a presentation (case-insensitive dedup, blank refused)
 * - a shared tag id across presentations by name
 * - bulk fetch (list views)
 * - org-wide list with usage counts
 * - create + delete (delete strips the tag from every link)
 * - prefix search (one case fold, and typed wildcards taken literally)
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
} from '../../server/storage/tags.js';
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

  it('refuses a blank name instead of dropping it (B370)', async () => {
    const r = await setTagsForPresentation(storageScope, p1, ['Sales', '']);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'invalid');
    assert.strictEqual(r.field, 'tags');
    // It used to answer 200 with the name silently gone; the contract and its
    // wire shape live in tests/pg/tag-name-contract.pgtest.js.
    assert.strictEqual(r.fieldProblem.index, 1);
  });

  it('sets and gets tags for a presentation (sorted, deduped)', async () => {
    const set = await setTagsForPresentation(storageScope, p1, [
      'Sales',
      'sales',
      'Q3',
    ]);
    // 'sales' is the same tag as 'Sales' — the database's fold decides that.
    assert.strictEqual(set.ok, true);
    assert.deepStrictEqual(set.tags.map((t) => t.name).sort(), ['Q3', 'Sales']);

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
    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.tag.name, 'Engineering');
    const hits = await searchTags(storageScope, 'eng');
    assert.ok(hits.some((t) => t.name === 'Engineering'));
    // Unused tag has a zero count.
    assert.strictEqual(hits.find((t) => t.name === 'Engineering').count, 0);
  });

  it("finds a name whose JavaScript fold differs from PostgreSQL's", async () => {
    // B388: the prefix used to be lowercased in JavaScript and compared to
    // SQL `lower(tags.name)` — two folders for one comparison. They disagree
    // on U+0130: JavaScript answers `i` + a combining dot, the database (this
    // suite's `en_US.utf8`) answers a bare `i`, so the tag could not be found
    // by typing its own name. Folding only in SQL removes the disagreement.
    assert.strictEqual((await createTag(storageScope, 'İstanbul')).ok, true);

    const exact = await searchTags(storageScope, 'İstanbul');
    assert.ok(
      exact.some((t) => t.name === 'İstanbul'),
      'a tag is findable by its own name',
    );
    const prefix = await searchTags(storageScope, 'İs');
    assert.ok(prefix.some((t) => t.name === 'İstanbul'));
    // And the fold still folds: a plainly-typed prefix finds it too.
    const folded = await searchTags(storageScope, 'is');
    assert.ok(folded.some((t) => t.name === 'İstanbul'));
  });

  it('treats a typed %, _ or backslash as a letter, not a wildcard', async () => {
    for (const name of ['100% pure', '1000 ideas', 'a_b', 'axb', 'C:\\temp']) {
      assert.strictEqual((await createTag(storageScope, name)).ok, true, name);
    }

    const percent = (await searchTags(storageScope, '100%')).map((t) => t.name);
    assert.deepStrictEqual(percent, ['100% pure']);

    const underscore = (await searchTags(storageScope, 'a_')).map(
      (t) => t.name,
    );
    assert.deepStrictEqual(underscore, ['a_b']);

    const backslash = (await searchTags(storageScope, 'C:\\')).map(
      (t) => t.name,
    );
    assert.deepStrictEqual(backslash, ['C:\\temp']);
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
