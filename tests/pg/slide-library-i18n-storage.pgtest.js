/**
 * Slide-library i18n persistence against real PostgreSQL, through the facade.
 *
 * A library slide can carry per-language content (`i18n.versions[lang]`). The
 * pure read projection (`mapSlideLibraryRow`) is covered DB-lessly in
 * tests/slide-library-i18n-storage.test.js. What that suite could *not* cover —
 * it says so in its own header — is the Postgres **write** path: migration 049's
 * `i18n` jsonb column and the create/update round-trip through
 * postgres/slides.js. This is that test: create a personal library item with
 * two languages, and assert both survive create, read-back, and update on real
 * PostgreSQL.
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
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPersonalLibraryItem,
  listPersonalLibrary,
  updatePersonalLibraryItem,
} from '../../server/storage/slide-library/index.js';

const storageScope = testScope();
const ALICE = 'alice@example.com';

const BILINGUAL = {
  versions: {
    nl: { content: { title: 'Hallo' } },
    'en-GB': { content: { title: 'Hello' } },
  },
};

pgDescribe('slide-library i18n round-trip (real PostgreSQL, via facade)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  it('keeps both languages through create, read-back and update', async () => {
    const created = await createPersonalLibraryItem(
      storageScope,
      ALICE,
      { name: 'Intro', slideType: 'content-slide', content: { title: 'Hallo' }, i18n: BILINGUAL },
      { actorEmail: ALICE }
    );
    assert.ok(created?.ok && created.item?.id, 'created item has an id');
    assert.deepStrictEqual(created.item.i18n, BILINGUAL, 'i18n survives create');

    const listed = await listPersonalLibrary(storageScope, ALICE);
    const found = listed.items.find((i) => i.id === created.item.id);
    assert.deepStrictEqual(found?.i18n, BILINGUAL, 'i18n survives read-back');

    const nextI18n = {
      versions: {
        nl: { content: { title: 'Dag' } },
        'en-GB': { content: { title: 'Bye' } },
      },
    };
    const updated = await updatePersonalLibraryItem(
      storageScope,
      ALICE,
      created.item.id,
      { i18n: nextI18n },
      { actorEmail: ALICE }
    );
    assert.ok(updated?.ok, 'update ok');
    assert.deepStrictEqual(updated.item.i18n, nextI18n, 'i18n survives update');
  });
});
