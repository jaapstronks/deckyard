/**
 * B352: the sandbox seeds its organization shelf, idempotently, against real
 * PostgreSQL.
 *
 * `seedSandboxLibrary` (server/sandbox/library.js) writes the declared example
 * slides and collection at boot. This pins that the rows land on the
 * organization shelf under the system maker, that a second boot changes
 * nothing, that a boot after a drift restores the declared state, and that a
 * guest reads the items but may not change them (D170 + D181).
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';
import { initializeThemeSeeds } from '../../server/utils/theme-seeds.js';
import { repoRoot } from '../../server/config/paths.js';
import {
  SANDBOX_LIBRARY_OWNER,
  readSandboxLibrarySeed,
  seedRowId,
  seedSandboxLibrary,
} from '../../server/sandbox/library.js';
import {
  listOrganizationLibrary,
  updateOrganizationLibraryItem,
} from '../../server/storage/slide-library.js';
import { listOrganizationCollections } from '../../server/storage/collections.js';
import { handleSlideLibrary } from '../../server/routes/api/slide-library.js';
import { handleSlideCollections } from '../../server/routes/api/slide-collections.js';

const GUEST = 'guest-0123456789abcdef0123456789abcdef@sandbox.local';
const scope = () => ({ organizationId: getDefaultOrganizationId() });

function fakeRes() {
  return {
    statusCode: 0,
    body: '',
    headersSent: false,
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk) this.body += chunk;
    },
  };
}

pgDescribe('sandbox library seed (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let prevSandboxMode;
  let declared;

  before(async () => {
    db = await openTestDb();
    prevSandboxMode = process.env.SANDBOX_MODE;
    process.env.SANDBOX_MODE = '1';
    declared = await readSandboxLibrarySeed(repoRoot);
  });

  after(async () => {
    if (prevSandboxMode === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = prevSandboxMode;
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    await initializeThemeSeeds();
  });

  it('puts every declared slide and collection on the organization shelf', async () => {
    await seedSandboxLibrary(repoRoot);

    const { items } = await listOrganizationLibrary(scope(), {
      userEmail: GUEST,
    });
    assert.equal(items.length, declared.slides.length);
    for (const item of items) {
      assert.equal(item.shelf, 'organization');
      assert.equal(item.ownerEmail, SANDBOX_LIBRARY_OWNER);
      assert.equal(item.createdBy?.displayName, 'Deckyard');
      assert.ok(item.themeId, `${item.name} has a theme record id`);
    }

    const collections = await listOrganizationCollections(scope(), {
      userEmail: GUEST,
    });
    const list = collections.items;
    assert.equal(list.length, declared.collections.length);
    const [first] = declared.collections;
    const col = list.find((c) => c.id === seedRowId('collection', first.key));
    assert.deepEqual(
      col.slideIds,
      first.slides.map((key) => seedRowId('slide', key)),
    );
  });

  it('a second boot writes nothing; a drifted row is restored', async () => {
    await seedSandboxLibrary(repoRoot);
    const before = await db
      .selectFrom('slide_library')
      .select(['id', 'updated_at'])
      .execute();

    await seedSandboxLibrary(repoRoot);
    const again = await db
      .selectFrom('slide_library')
      .select(['id', 'updated_at'])
      .execute();
    assert.equal(again.length, before.length);
    const stamp = new Map(before.map((r) => [r.id, String(r.updated_at)]));
    for (const row of again)
      assert.equal(String(row.updated_at), stamp.get(row.id), 'untouched');

    const id = seedRowId('slide', declared.slides[0].key);
    await db
      .updateTable('slide_library')
      .set({ name: 'Drifted', trashed_at: new Date().toISOString() })
      .where('id', '=', id)
      .execute();
    await seedSandboxLibrary(repoRoot);
    const row = await db
      .selectFrom('slide_library')
      .select(['name', 'trashed_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    assert.equal(row.name, declared.slides[0].name);
    assert.equal(row.trashed_at, null);
  });

  it('a guest reads the seeded slides and collection but may not change them', async () => {
    await seedSandboxLibrary(repoRoot);
    const res = fakeRes();
    await handleSlideLibrary({
      repoRoot,
      storageScope: scope(),
      req: { method: 'GET', headers: {} },
      res,
      url: new URL('http://x/api/slide-library/organization'),
      authedUser: { email: GUEST, isAdmin: false },
    });
    assert.equal(res.statusCode, 200);
    const { items } = JSON.parse(res.body);
    assert.equal(items.length, declared.slides.length);
    assert.ok(items.every((item) => item.canEdit === false));

    const colRes = fakeRes();
    await handleSlideCollections({
      repoRoot,
      storageScope: scope(),
      req: { method: 'GET', headers: {} },
      res: colRes,
      url: new URL('http://x/api/slide-collections/organization'),
      authedUser: { email: GUEST, isAdmin: false },
    });
    assert.equal(colRes.statusCode, 200);
    const cols = JSON.parse(colRes.body).items;
    assert.equal(cols.length, declared.collections.length);
    assert.ok(cols.every((col) => col.canEdit === false));

    const id = seedRowId('slide', declared.slides[0].key);
    const refused = await updateOrganizationLibraryItem(
      scope(),
      id,
      { trashed: true },
      { actorEmail: GUEST, allowEdit: () => false },
    );
    assert.equal(refused.ok, false);
  });
});
