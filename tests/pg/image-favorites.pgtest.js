/**
 * Image favorites against real PostgreSQL, through the image-library facade.
 *
 * The favorite row's PRIMARY KEY is the composite `(image_id, user_email,
 * organization_id)` (migration 033), and `image_id` is a NOT NULL FK to
 * `image_library(id)`. A real database is what proves the FK-bound favorite is
 * cascaded away when its image is deleted.
 *
 * B79/D34 folded the favorites logic into the facade
 * (server/storage/image-library.js); the granular add/is/remove helpers
 * are now private. `toggleImageFavorite` read-guards duplicates, so the
 * `insert … ON CONFLICT DO NOTHING` inside the private `addFavorite` is a
 * concurrency guard (two racing toggles) that is not serially reachable through
 * the public surface — it is no longer exercised by a direct double-add here.
 *
 * B344/D176 added the second half: what the stored row is *called* on the wire.
 * One spelling for the concept, `favorite`, on every item a route hands back —
 * so the route-level block at the bottom drives the real `handleImageLibrary`
 * rather than the facade. The half no response assertion can reach (that no
 * reader accepts `isFavorite` as well) is a grep in
 * `tests/image-library-favorite-guard.test.js`.
 *
 * B374 added the third: the bulk export is not a route, so no wire assertion
 * reaches it, and `image-library/index.json` shipped starless while the
 * slide-library halves of the same ZIP carried the flag. The bottom block
 * builds a real export and reads the bundle back.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile, rm } from 'node:fs/promises';

import JSZip from 'jszip';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import {
  seedDefaultOrganization,
  seedImageLibraryItem,
} from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  getImageFavorites,
  toggleImageFavorite,
} from '../../server/storage/image-library.js';
import { handleImageLibrary } from '../../server/routes/api/image-library.js';
import { buildBulkExport } from '../../server/export/bulk-export.js';

const storageScope = testScope();
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

pgDescribe('image favorites (real PostgreSQL, via facade)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let imageId;

  const countFor = async (email) => {
    const row = await db
      .selectFrom('image_library_favorites')
      .select(db.fn.countAll().as('n'))
      .where('user_email', '=', email)
      .executeTakeFirst();
    return Number(row.n);
  };

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    imageId = await seedImageLibraryItem(db);
  });

  it('adds a favorite and reads it back', async () => {
    assert.equal(await toggleImageFavorite(storageScope, imageId, ALICE), true);

    assert.deepEqual(await getImageFavorites(storageScope, ALICE), [imageId]);
    assert.equal(await countFor(ALICE), 1);
  });

  it('toggling an already-favorited image off leaves no duplicate rows', async () => {
    await toggleImageFavorite(storageScope, imageId, ALICE);
    // A second toggle removes rather than inserting a duplicate; the composite
    // PK is never doubled.
    assert.equal(
      await toggleImageFavorite(storageScope, imageId, ALICE),
      false,
    );

    assert.equal(await countFor(ALICE), 0, 'no favorite rows remain');
  });

  it('keeps favorites per user', async () => {
    await toggleImageFavorite(storageScope, imageId, ALICE);

    assert.deepEqual(
      await getImageFavorites(storageScope, BOB),
      [],
      "Bob sees none of Alice's",
    );
    assert.deepEqual(await getImageFavorites(storageScope, ALICE), [imageId]);
  });

  it('toggles on and off through the facade', async () => {
    assert.equal(await toggleImageFavorite(storageScope, imageId, ALICE), true);
    assert.deepEqual(await getImageFavorites(storageScope, ALICE), [imageId]);

    assert.equal(
      await toggleImageFavorite(storageScope, imageId, ALICE),
      false,
    );
    assert.deepEqual(await getImageFavorites(storageScope, ALICE), []);
    assert.equal(await countFor(ALICE), 0);
  });

  it('cascades favorites away when the image is deleted (FK CASCADE)', async () => {
    await toggleImageFavorite(storageScope, imageId, ALICE);

    await db.deleteFrom('image_library').where('id', '=', imageId).execute();
    assert.equal(await countFor(ALICE), 0, 'the favorite is cascaded out');
  });
});

// ===========================================================================
// The wire: one spelling, on every item a route hands back (B344, D176)
// ===========================================================================
//
// Before B344 the list said `isFavorite`, repeated the same fact as a
// top-level `favoriteIds` array that no client read, and left the flag off
// every single-item response — so the detail view, which re-renders from the
// PUT answer, un-starred an image the moment you saved its tags.

process.env.IMAGE_LIBRARY_ENABLED = 'true';

const ALICE_USER = {
  id: 'user-alice',
  email: ALICE,
  organizationRole: 'admin',
  isAdmin: true,
};
const BOB_USER = { id: 'user-bob', email: BOB, organizationRole: 'member' };

function mockRes() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    writeHead(c, headers) {
      this.statusCode = c;
      Object.assign(this.headers, headers);
    },
    end(payload) {
      this.payload = payload ? JSON.parse(payload) : null;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

async function call(user, method, path, body) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  const res = mockRes();
  await handleImageLibrary({
    repoRoot: '/tmp',
    storageScope,
    authedUser: user,
    req,
    res,
    url: { pathname: path, searchParams: new URLSearchParams() },
  });
  return res;
}

const star = (user, id) =>
  call(user, 'POST', `/api/image-library/${id}/favorite`);

async function listedItem(user, id) {
  const res = await call(user, 'GET', '/api/image-library');
  assert.equal(res.statusCode, 200);
  const item = res.payload.items.find((it) => it.id === id);
  assert.ok(item, `image ${id} is listed`);
  return item;
}

pgDescribe(
  'image favorites on the wire (real PostgreSQL, via the route)',
  () => {
    /** @type {import('kysely').Kysely<any>} */
    let db;
    /** @type {string} */
    let imageId;

    before(async () => {
      db = await openTestDb();
      await installFacadeStorage();
    });

    after(async () => {
      uninstallFacadeStorage();
      await closeTestDb(db);
    });

    beforeEach(async () => {
      await truncate(db, 'organizations');
      await seedDefaultOrganization(db);
      imageId = await seedImageLibraryItem(db);
    });

    it('the list carries `favorite` per item and no second copy of the set', async () => {
      const res = await call(ALICE_USER, 'GET', '/api/image-library');
      assert.equal(res.statusCode, 200);

      const item = res.payload.items.find((it) => it.id === imageId);
      assert.ok(item);
      assert.equal(item.favorite, false, 'nobody has starred it yet');
      assert.equal('isFavorite' in item, false, 'the old spelling is gone');

      // The starred-id list was the same fact in a second shape, with no reader.
      assert.equal(
        'favoriteIds' in res.payload,
        false,
        'no id list beside the per-item flag',
      );
    });

    it('the toggle answers { id, favorite }, and the list follows it', async () => {
      const on = await star(ALICE_USER, imageId);
      assert.equal(on.statusCode, 200);
      assert.deepEqual(
        on.payload,
        { id: imageId, favorite: true },
        'the whole answer, so a second key cannot slip in unnoticed',
      );
      assert.equal((await listedItem(ALICE_USER, imageId)).favorite, true);

      const off = await star(ALICE_USER, imageId);
      assert.deepEqual(off.payload, { id: imageId, favorite: false });
      assert.equal((await listedItem(ALICE_USER, imageId)).favorite, false);
    });

    it('the star is the caller`s own, and an anonymous reader has none', async () => {
      await star(ALICE_USER, imageId);

      assert.equal((await listedItem(ALICE_USER, imageId)).favorite, true);
      assert.equal(
        (await listedItem(BOB_USER, imageId)).favorite,
        false,
        "Alice's star is not Bob's",
      );
      assert.equal(
        (await listedItem(undefined, imageId)).favorite,
        false,
        'no caller, no star — and still the field',
      );
    });

    it('GET one carries the same flag as the list', async () => {
      await star(ALICE_USER, imageId);

      const alice = await call(
        ALICE_USER,
        'GET',
        `/api/image-library/${imageId}`,
      );
      assert.equal(alice.statusCode, 200);
      assert.equal(alice.payload.favorite, true);
      assert.equal('isFavorite' in alice.payload, false);

      const bob = await call(BOB_USER, 'GET', `/api/image-library/${imageId}`);
      assert.equal(bob.payload.favorite, false);
    });

    it('a save answers with the star still on the item', async () => {
      await star(ALICE_USER, imageId);

      const saved = await call(
        ALICE_USER,
        'PUT',
        `/api/image-library/${imageId}`,
        {
          description: 'Edited while starred',
          tags: ['logo', 'icon'],
        },
      );
      assert.equal(saved.statusCode, 200);
      assert.equal(saved.payload.description, 'Edited while starred');
      assert.equal(saved.payload.favorite, true, 'the star survives the save');
      assert.equal('isFavorite' in saved.payload, false);
    });

    it('`favorite` is derived, never an input to a save', async () => {
      // Both spellings in one body, so neither is a back door into the state.
      const saved = await call(
        ALICE_USER,
        'PUT',
        `/api/image-library/${imageId}`,
        {
          description: 'Still not starred',
          favorite: true,
          isFavorite: true,
        },
      );
      assert.equal(saved.statusCode, 200);
      assert.equal(
        saved.payload.favorite,
        false,
        'the patch cannot write the caller a star',
      );
      assert.deepEqual(await getImageFavorites(storageScope, ALICE), []);
    });

    it('a created image answers in the same shape', async () => {
      const res = await call(ALICE_USER, 'POST', '/api/image-library', {
        url: '/uploads/fresh.png',
        title: 'Fresh',
      });
      assert.equal(res.statusCode, 201);
      assert.equal(res.payload.favorite, false, 'a fresh image is nobody’s');
      assert.equal('isFavorite' in res.payload, false);
    });
  },
);

// ===========================================================================
// The backup: the exported library carries the exporter's star (B374, D176)
// ===========================================================================
//
// D176 names the bulk export ("so the bulk export carries the exporter's own
// flag"), but `image-library/index.json` came straight out of
// `listImageLibrary()` and arrived starless, while the slide-library halves of
// the same ZIP carried the flag out of their row mapper. The export is not a
// route, so no wire assertion above reaches it: this block drives the real
// `buildBulkExport` and reads the bundle back.

pgDescribe('image favorites in the bulk export (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let imageId;

  /** Read `image-library/index.json` back out of a built export ZIP. */
  async function exportedImages(userEmail) {
    const { filePath } = await buildBulkExport({
      repoRoot: '/tmp',
      userEmail,
      organizationId: storageScope.organizationId,
      options: { includeImageLibrary: true },
    });
    try {
      const zip = await JSZip.loadAsync(await readFile(filePath));
      return JSON.parse(
        await zip.file('image-library/index.json').async('string'),
      );
    } finally {
      await rm(filePath, { force: true });
    }
  }

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    // A local path, so building the export resolves it off disk (and fails
    // quietly) instead of reaching for the network.
    imageId = await seedImageLibraryItem(db, { url: '/uploads/b374.png' });
  });

  it('carries the exporter’s own star, not somebody else’s', async () => {
    await toggleImageFavorite(storageScope, imageId, ALICE);

    const [mine] = await exportedImages(ALICE);
    assert.equal(mine.id, imageId);
    assert.equal(mine.favorite, true, 'Alice backs up her own star');

    const [theirs] = await exportedImages(BOB);
    assert.equal(
      theirs.favorite,
      false,
      "Bob's backup does not inherit Alice's star",
    );
  });

  it('carries the flag on an unstarred image too', async () => {
    const [item] = await exportedImages(ALICE);
    assert.equal(item.favorite, false, 'nobody has starred it yet');
    assert.equal('isFavorite' in item, false, 'the old spelling is gone');
  });
});
