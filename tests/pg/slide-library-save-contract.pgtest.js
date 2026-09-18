/**
 * The slide-library save contract (D170, B335) against real PostgreSQL.
 *
 * Before B335 `updateSlideLibraryRow` and `deleteSlideLibraryRow` filtered on
 * `id` and `organization_id` only: any signed-in user could patch or delete a
 * colleague's personal item through the personal route, reach an
 * organization item through it, and change organization content with no guard
 * at all. A `content` patch also left `i18n.versions[dominant]` on the old
 * text, so a deck composed from the item got the stale prose.
 *
 * What this pins, in the storage layer where the WHERE clause lives:
 *  - someone else's personal item is `not_found` on update and delete (its
 *    existence is not given away);
 *  - the personal functions never touch an organization item;
 *  - organization content follows the creator-or-admin guard (`forbidden`);
 *  - a stale revision is `ConflictError` and writes nothing, and the revision
 *    rises on every name/description/content write;
 *  - a content patch rebuilds the language versions on the server.
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
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createOrganizationLibraryItem,
  createPersonalLibraryItem,
  deleteOrganizationLibraryItem,
  deletePersonalLibraryItem,
  listPersonalLibrary,
  updateOrganizationLibraryItem,
  updatePersonalLibraryItem,
} from '../../server/storage/slide-library.js';
import { ConflictError } from '../../server/utils/errors.js';

const storageScope = testScope();
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

async function readRow(db, id) {
  return db
    .selectFrom('slide_library')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

pgDescribe('slide-library save contract (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let alicePersonal;
  let orgItem;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'slide_library', 'organizations');
    await seedDefaultOrganization(db);
    const p = await createPersonalLibraryItem(
      storageScope,
      ALICE,
      {
        name: 'Mine',
        slideType: 'content-slide',
        content: { title: 'Hallo' },
      },
      { actorEmail: ALICE },
    );
    alicePersonal = p.item;
    const o = await createOrganizationLibraryItem(
      storageScope,
      { name: 'Team', slideType: 'content-slide', content: { title: 'Team' } },
      { actorEmail: ALICE },
    );
    orgItem = o.item;
  });

  it('starts every item at revision 0', () => {
    assert.equal(alicePersonal.revision, 0);
    assert.equal(orgItem.revision, 0);
  });

  it("answers not_found when Bob patches Alice's personal item, and writes nothing", async () => {
    const r = await updatePersonalLibraryItem(
      storageScope,
      BOB,
      alicePersonal.id,
      { name: 'Hijacked' },
      { actorEmail: BOB, expectedRevision: 0 },
    );
    assert.deepEqual(r, { ok: false, reason: 'not_found' });
    const row = await readRow(db, alicePersonal.id);
    assert.equal(row.name, 'Mine');
  });

  it("answers not_found when Bob deletes Alice's personal item, and it survives", async () => {
    const r = await deletePersonalLibraryItem(
      storageScope,
      BOB,
      alicePersonal.id,
    );
    assert.deepEqual(r, { ok: false, reason: 'not_found' });
    assert.ok(await readRow(db, alicePersonal.id));
  });

  it('never reaches an organization item through the personal functions', async () => {
    const u = await updatePersonalLibraryItem(
      storageScope,
      ALICE,
      orgItem.id,
      { name: 'Via personal' },
      { actorEmail: ALICE, expectedRevision: 0 },
    );
    assert.deepEqual(u, { ok: false, reason: 'not_found' });
    const d = await deletePersonalLibraryItem(storageScope, ALICE, orgItem.id);
    assert.deepEqual(d, { ok: false, reason: 'not_found' });
    assert.equal((await readRow(db, orgItem.id)).name, 'Team');
  });

  it('never reaches a personal item through the organization functions', async () => {
    const u = await updateOrganizationLibraryItem(
      storageScope,
      alicePersonal.id,
      { name: 'Via org' },
      { actorEmail: ALICE, expectedRevision: 0, allowEdit: () => true },
    );
    assert.deepEqual(u, { ok: false, reason: 'not_found' });
    const d = await deleteOrganizationLibraryItem(
      storageScope,
      alicePersonal.id,
      { actorEmail: ALICE, allowDelete: () => true },
    );
    assert.deepEqual(d, { ok: false, reason: 'not_found' });
  });

  it('refuses organization content to an actor the guard rejects', async () => {
    const r = await updateOrganizationLibraryItem(
      storageScope,
      orgItem.id,
      { content: { title: 'Bob was here' } },
      { actorEmail: BOB, expectedRevision: 0, allowEdit: () => false },
    );
    assert.deepEqual(r, { ok: false, reason: 'forbidden' });
    assert.deepEqual((await readRow(db, orgItem.id)).content, {
      title: 'Team',
    });
  });

  it('lets an actor the guard accepts change organization content, and raises the revision', async () => {
    const r = await updateOrganizationLibraryItem(
      storageScope,
      orgItem.id,
      { content: { title: 'Nieuw' } },
      { actorEmail: ALICE, expectedRevision: 0, allowEdit: () => true },
    );
    assert.equal(r.ok, true);
    assert.equal(r.item.revision, 1);
    assert.deepEqual(r.item.content, { title: 'Nieuw' });
  });

  it('throws ConflictError on a stale revision and writes nothing', async () => {
    const first = await updatePersonalLibraryItem(
      storageScope,
      ALICE,
      alicePersonal.id,
      { name: 'First' },
      { actorEmail: ALICE, expectedRevision: 0 },
    );
    assert.equal(first.item.revision, 1);
    await assert.rejects(
      updatePersonalLibraryItem(
        storageScope,
        ALICE,
        alicePersonal.id,
        { name: 'Stale' },
        { actorEmail: ALICE, expectedRevision: 0 },
      ),
      (err) => {
        assert.ok(err instanceof ConflictError);
        assert.equal(err.details.id, alicePersonal.id);
        assert.equal(err.details.revision, 1);
        return true;
      },
    );
    assert.equal((await readRow(db, alicePersonal.id)).name, 'First');
  });

  it('refuses content the contentGuard rejects, with its message, and writes nothing', async () => {
    const r = await updatePersonalLibraryItem(
      storageScope,
      ALICE,
      alicePersonal.id,
      { content: { title: 'Nope' } },
      {
        actorEmail: ALICE,
        expectedRevision: 0,
        contentGuard: () => 'no markup for you',
      },
    );
    assert.deepEqual(r, {
      ok: false,
      reason: 'forbidden',
      message: 'no markup for you',
    });
    assert.deepEqual((await readRow(db, alicePersonal.id)).content, {
      title: 'Hallo',
    });
  });

  it('does not raise the revision for a trash toggle', async () => {
    const r = await updatePersonalLibraryItem(
      storageScope,
      ALICE,
      alicePersonal.id,
      { trashed: true },
      { actorEmail: ALICE },
    );
    assert.equal(r.ok, true);
    assert.equal(r.item.revision, 0);
    assert.ok(r.item.trashedAt);
  });

  it('keeps versions[dominant] equal to content and the other language structural after a content patch', async () => {
    const created = await createPersonalLibraryItem(
      storageScope,
      ALICE,
      {
        name: 'Tweetalig',
        slideType: 'content-slide',
        content: { title: 'Hallo', body: 'Tekst' },
        i18n: {
          dominant: 'nl',
          versions: {
            nl: { content: { title: 'Hallo', body: 'Tekst' } },
            'en-GB': { content: { title: 'Hello', body: 'Text' } },
          },
        },
      },
      { actorEmail: ALICE },
    );
    const r = await updatePersonalLibraryItem(
      storageScope,
      ALICE,
      created.item.id,
      { content: { title: 'Dag', body: 'Tekst' } },
      { actorEmail: ALICE, expectedRevision: 0 },
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.item.i18n.versions.nl.content, {
      title: 'Dag',
      body: 'Tekst',
    });
    assert.deepEqual(r.item.i18n.versions['en-GB'].content, {
      title: 'Hello',
      body: 'Text',
    });
    const listed = await listPersonalLibrary(storageScope, ALICE);
    const found = listed.items.find((i) => i.id === created.item.id);
    assert.deepEqual(found.i18n.versions.nl.content, found.content);
  });
});
