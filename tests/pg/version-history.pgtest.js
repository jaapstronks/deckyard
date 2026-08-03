/**
 * Version history through the storage facade against real PostgreSQL.
 *
 * The PostgreSQL counterpart of part 1 of tests/pg-version-history.test.js (the
 * `version history via the facade (file adapter)` block). The presentations
 * facade (server/storage/presentations/index.js) drives version
 * create/list/get/prune through the adapter; this exercises that on the backend
 * PR G keeps.
 *
 * The file suite additionally asserted the snapshot landed at a specific
 * on-disk path — an implementation detail of the file adapter that PR G removes
 * — so that assertion has no PostgreSQL counterpart and is intentionally
 * dropped. Likewise the file summary's `slideCount` field is file-only (the
 * PostgreSQL summary is column-projected, postgres/presentations.js +
 * mappers.mapVersionRowSummary); this asserts the columns that path returns
 * instead.
 *
 * Part 2 of the file suite — the migration-053 idempotency check — runs against
 * a hand-rolled fake db, not the file adapter, so it stays put.
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
  createPresentationVersion,
  listPresentationVersions,
  getPresentationVersion,
  prunePresentationVersions,
} from '../../server/storage/presentations/index.js';

const scope = testScope();

pgDescribe('version history via the facade (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  // presentation_versions.presentation_id foreign-keys presentations.id, so the
  // deck the snapshot belongs to is a seeded row, not the file suite's 'deck-1'.
  let deckId;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    deckId = await seedPresentation(db, { title: 'My deck' });
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  it('creates, lists and gets a version snapshot', async () => {
    const pres = {
      id: deckId,
      title: 'My deck',
      revision: 7,
      slides: [{ id: 's1', type: 'title-slide', content: {} }],
    };

    const created = await createPresentationVersion(scope, deckId, pres, {
      actorEmail: 'alice@example.com',
      reason: 'manual',
      label: 'checkpoint',
    });
    assert.ok(created, 'create returned a snapshot');
    assert.ok(created.id, 'snapshot has an id');
    assert.strictEqual(created.presentationId, deckId);
    assert.strictEqual(created.reason, 'manual');
    assert.strictEqual(created.label, 'checkpoint');
    assert.strictEqual(created.revision, 7);
    assert.strictEqual(created.createdBy, 'alice@example.com');

    const list = await listPresentationVersions(scope, deckId);
    assert.strictEqual(list.length, 1, 'one version listed');
    assert.strictEqual(list[0].id, created.id);
    assert.strictEqual(list[0].reason, 'manual');
    // The PostgreSQL summary is column-projected — it carries revision, not the
    // file backend's derived slideCount.
    assert.strictEqual(list[0].revision, 7);
    assert.strictEqual(list[0].label, 'checkpoint');

    const full = await getPresentationVersion(scope, deckId, created.id);
    assert.ok(full, 'full version fetched');
    assert.strictEqual(full.id, created.id);
    assert.ok(full.presentation, 'full version carries the presentation payload');
    assert.strictEqual(full.presentation.title, 'My deck');
    assert.deepStrictEqual(full.presentation.slides, pres.slides);
  });

  it('prunes through the adapter without dropping recent snapshots', async () => {
    // Retention keeps recent snapshots; this proves the wire-through works and
    // the single manual snapshot survives.
    await prunePresentationVersions(scope, deckId);
    const list = await listPresentationVersions(scope, deckId);
    assert.strictEqual(list.length, 1, 'recent manual snapshot retained');
  });
});
