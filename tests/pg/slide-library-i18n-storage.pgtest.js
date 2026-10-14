/**
 * Slide-library i18n persistence against real PostgreSQL, through the facade.
 *
 * A library slide can carry per-language content (`i18n.versions[lang]`). The
 * pure read projection (`mapSlideLibraryRow`) is covered DB-lessly in
 * tests/slide-library-i18n-storage.test.js. What that suite could *not* cover —
 * it says so in its own header — is the Postgres **write** path: migration 049's
 * `i18n` jsonb column and the create/update round-trip through
 * server/storage/slide-library.js. This is that test: create a personal library item with
 * two languages, and assert both survive create and read-back on real
 * PostgreSQL, and that a PATCH cannot overwrite them: since D170 the versions
 * are derived by the server from `content` (tests/pg/slide-library-save-contract.pgtest.js).
 */

import { after, before, it } from 'node:test';
import assert from 'node:assert';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPersonalLibraryItem,
  listPersonalLibrary,
  updatePersonalLibraryItem,
  createOrganizationLibraryItem,
  listOrganizationLibrary,
  updateOrganizationLibraryItem,
} from '../../server/storage/slide-library.js';

const storageScope = testScope();
const ALICE = 'alice@example.com';

const BILINGUAL = {
  versions: {
    nl: { content: { title: 'Hallo' } },
    'en-GB': { content: { title: 'Hello' } },
  },
};

pgDescribe(
  'slide-library i18n round-trip (real PostgreSQL, via facade)',
  () => {
    /** @type {import('kysely').Kysely<any>} */
    let db;

    before(async () => {
      db = await openTestDb();
      await installFacadeStorage();
      await truncate(db, 'organizations');
      await seedDefaultOrganization(db);
    });

    after(async () => {
      await closeTestDb(db);
    });

    for (const shelf of ['personal', 'organization']) {
      const create = (input) =>
        shelf === 'personal'
          ? createPersonalLibraryItem(storageScope, ALICE, input, {
              actorEmail: ALICE,
            })
          : createOrganizationLibraryItem(storageScope, input, {
              actorEmail: ALICE,
            });
      const list = () =>
        shelf === 'personal'
          ? listPersonalLibrary(storageScope, ALICE)
          : listOrganizationLibrary(storageScope, { userEmail: ALICE });

      it(`${shelf}: optional i18n fields may be omitted`, async () => {
        for (const i18n of [
          undefined,
          {},
          { dominant: 'nl' },
          { versions: { nl: {} } },
        ]) {
          const result = await create({
            name: 'Optional',
            slideType: 'content-slide',
            i18n,
          });
          assert.equal(result.ok, true);
          assert.deepStrictEqual(result.item.i18n, i18n ?? {});
        }
      });

      it(`${shelf}: a bilingual create/read/content-edit keeps translated prose and metadata`, async () => {
        const i18n = {
          dominant: 'nl',
          translatedAt: '2026-10-12',
          versions: {
            nl: { content: { title: 'Hallo', author: 'Maker' } },
            'en-GB': {
              source: 'human',
              content: { title: 'Hello', author: 'Maker' },
            },
          },
        };
        const created = await create({
          name: 'Bilingual',
          slideType: 'content-slide',
          content: i18n.versions.nl.content,
          i18n,
        });
        assert.equal(created.ok, true);
        assert.deepStrictEqual(created.item.i18n, i18n);
        const read = (await list()).items.find(
          (item) => item.id === created.item.id,
        );
        assert.deepStrictEqual(read.i18n, i18n);
        const content = { title: 'Dag', author: 'Maker' };
        const opts = {
          actorEmail: ALICE,
          expectedRevision: read.revision,
          allowEdit: () => true,
        };
        const edited =
          shelf === 'personal'
            ? await updatePersonalLibraryItem(
                storageScope,
                ALICE,
                read.id,
                { content },
                opts,
              )
            : await updateOrganizationLibraryItem(
                storageScope,
                read.id,
                { content },
                opts,
              );
        assert.equal(edited.ok, true);
        const expected = {
          ...i18n,
          versions: { ...i18n.versions, nl: { content } },
        };
        assert.deepStrictEqual(edited.item.i18n, expected);
        assert.deepStrictEqual(
          (await list()).items.find((item) => item.id === read.id).i18n,
          expected,
        );
      });

      it(`${shelf}: malformed nested language data never inserts a row`, async () => {
        for (const i18n of [
          [],
          'text',
          null,
          { versions: [] },
          { versions: 'text' },
          { versions: null },
          { versions: { nl: null } },
          { versions: { nl: [] } },
          { versions: { nl: 'text' } },
          { versions: { 'en-GB': { content: 'text' } } },
          { versions: { 'en-GB': { content: [] } } },
          { versions: { 'en-GB': { content: null } } },
        ]) {
          const before = await db
            .selectFrom('slide_library')
            .selectAll()
            .execute();
          await assert.rejects(
            () =>
              create({ name: 'Malformed', slideType: 'content-slide', i18n }),
            (err) =>
              err.code === 'invalid' &&
              err.statusCode === 400 &&
              err.details.field.startsWith('i18n'),
          );
          assert.deepStrictEqual(
            await db.selectFrom('slide_library').selectAll().execute(),
            before,
          );
        }
      });
    }

    it('keeps both languages through create, read-back and update', async () => {
      const created = await createPersonalLibraryItem(
        storageScope,
        ALICE,
        {
          name: 'Intro',
          slideType: 'content-slide',
          content: { title: 'Hallo' },
          i18n: BILINGUAL,
        },
        { actorEmail: ALICE },
      );
      assert.ok(created?.ok && created.item?.id, 'created item has an id');
      assert.deepStrictEqual(
        created.item.i18n,
        BILINGUAL,
        'i18n survives create',
      );

      const listed = await listPersonalLibrary(storageScope, ALICE);
      const found = listed.items.find((i) => i.id === created.item.id);
      assert.deepStrictEqual(found?.i18n, BILINGUAL, 'i18n survives read-back');

      const refused = await updatePersonalLibraryItem(
        storageScope,
        ALICE,
        created.item.id,
        { i18n: { versions: { nl: { content: { title: 'Dag' } } } } },
        { actorEmail: ALICE },
      );
      assert.equal(refused.ok, false);
      assert.equal(refused.reason, 'invalid', 'i18n is not a PATCH key');
      assert.equal(refused.field, 'body');
      assert.match(refused.message, /"i18n"/);
      const again = await listPersonalLibrary(storageScope, ALICE);
      assert.deepStrictEqual(
        again.items.find((i) => i.id === created.item.id)?.i18n,
        BILINGUAL,
        'the refused patch wrote nothing',
      );
    });

    it('stores an alias dominant canonical, so a content edit keeps the key canonical (B482)', async () => {
      const created = await createPersonalLibraryItem(
        storageScope,
        ALICE,
        {
          name: 'Alias',
          slideType: 'content-slide',
          content: { title: 'Hello' },
          i18n: {
            dominant: 'en',
            versions: { 'en-GB': { content: { title: 'Hello' } } },
          },
        },
        { actorEmail: ALICE },
      );
      assert.ok(created?.ok, JSON.stringify(created));
      assert.equal(created.item.i18n.dominant, 'en-GB');

      const edited = await updatePersonalLibraryItem(
        storageScope,
        ALICE,
        created.item.id,
        { content: { title: 'Hi' } },
        {
          actorEmail: ALICE,
          expectedRevision: created.item.revision,
        },
      );
      assert.ok(edited?.ok, JSON.stringify(edited));
      assert.deepStrictEqual(Object.keys(edited.item.i18n.versions), ['en-GB']);
      assert.equal(edited.item.i18n.versions['en-GB'].content.title, 'Hi');
    });
  },
);
