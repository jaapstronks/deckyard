/**
 * The instance-health measuring points on the author's side (B514, D247):
 * the presentations facade counts `slide_type.authored`, the export pipeline
 * and the bulk backup count `export`, and two things count nothing — a save
 * on a sandbox instance (D248) and opening a deck in the editor, which is not
 * a view.
 *
 * Handler- and facade-level over the database double, like the neighbours;
 * the counts land fire-and-forget, so every assertion reads through
 * `healthKeys`, which waits for them.
 *
 * Run with: node --test tests/instance-health-authoring-export.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';
import { healthKeys } from './helpers/instance-health.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const {
  createPresentation,
  duplicatePresentation,
  getPresentation,
  updatePresentation,
} = await import('../server/storage/presentations/index.js');
const { handleExports, ROUTES: EXPORT_ROUTES } =
  await import('../server/routes/api/export.js');
const { createExportRoute } = await import('../server/export/pipeline.js');
const { handleBulkExport } =
  await import('../server/routes/api/bulk-export.js');
const { slideTypeEntries } =
  await import('../server/storage/instance-health.js');

let brandSeed;
let db;

test.before(async () => {
  brandSeed = await brandSeedRow();
});

test.beforeEach(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    themes: [brandSeed],
    users: userRows(OWNER),
  });
  __setTestDb(db);
  await initializeStorage();
});

test.afterEach(() => {
  delete process.env.SANDBOX_MODE;
  __resetStorageForTests();
  __setTestDb(null);
});

const SLIDES = [
  { type: 'title-slide', content: { title: 'A' } },
  { type: 'content-slide', content: { title: 'B' } },
  { type: 'content-slide', content: { title: 'C' } },
];

function seedDeck(slides = SLIDES) {
  return createPresentation(testScope(process.cwd()), {
    title: 'Counted deck',
    ownerEmail: OWNER,
    theme: 'default',
    slides,
  });
}

/** Forget what the seeding counted, so a test sees only its own step. */
function clearCounts() {
  db.__tables.instance_health = [];
}

test('a new deck counts each of its types as authored, once', async () => {
  await seedDeck();
  assert.deepEqual(await healthKeys(db), [
    'slide_type.authored:content-slide',
    'slide_type.authored:title-slide',
  ]);
});

test('a duplicate is a new deck and counts its types', async () => {
  const pres = await seedDeck();
  await healthKeys(db);
  clearCounts();
  const copy = await duplicatePresentation(testScope(), pres.id, {
    actorEmail: OWNER,
  });
  assert.equal(copy.ok, true);
  assert.deepEqual(await healthKeys(db), [
    'slide_type.authored:content-slide',
    'slide_type.authored:title-slide',
  ]);
});

test('a save that carries slides counts them; a rename counts nothing', async () => {
  const pres = await seedDeck();
  await healthKeys(db);
  clearCounts();

  await updatePresentation(testScope(), pres.id, { title: 'Renamed' });
  assert.deepEqual(await healthKeys(db), []);

  // The count is the deck as stored, every language version included: the
  // version the create wrote still carries its types beside the new one.
  const saved = await updatePresentation(testScope(), pres.id, {
    slides: [{ type: 'quote-slide', content: { quote: 'Q' } }],
  });
  assert.deepEqual(
    await healthKeys(db),
    slideTypeEntries('slide_type.authored', saved)
      .map(({ axis, key }) => `${axis}:${key}`)
      .sort(),
  );
  assert.ok((await healthKeys(db)).includes('slide_type.authored:quote-slide'));
});

test('a save on a sandbox instance leaves no row (D248)', async () => {
  const pres = await seedDeck();
  await healthKeys(db);
  clearCounts();
  process.env.SANDBOX_MODE = 'true';
  const saved = await updatePresentation(testScope(), pres.id, {
    slides: [{ type: 'quote-slide', content: { quote: 'Q' } }],
  });
  assert.notEqual(saved.ok, false);
  assert.deepEqual(await healthKeys(db), []);
});

test('opening a deck in the editor is not a view', async () => {
  const pres = await seedDeck();
  await healthKeys(db);
  clearCounts();
  assert.ok(await getPresentation(testScope(), pres.id));
  assert.deepEqual(await healthKeys(db), []);
});

function fakeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

const OWNER_USER = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };

function exportContext(pathname, { user = OWNER_USER, method = 'GET' } = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = {};
  return {
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd(), { actorEmail: user?.email }),
    req,
    res: fakeRes(),
    url: new URL(pathname, 'http://localhost'),
    authedUser: user,
  };
}

test('an app export counts its format; a refused one counts nothing', async () => {
  const pres = await seedDeck();
  await healthKeys(db);
  clearCounts();

  const ok = exportContext(`/api/presentations/${pres.id}/export/json`);
  await handleExports(ok);
  assert.equal(ok.res.statusCode, 200);
  assert.deepEqual(await healthKeys(db), ['export:json']);

  clearCounts();
  const stranger = exportContext(`/api/presentations/${pres.id}/export/html`, {
    user: {
      id: userIdFor('stranger@example.com'),
      email: 'stranger@example.com',
      organizationId: ORG,
    },
  });
  await handleExports(stranger);
  assert.equal(stranger.res.statusCode, 403);
  assert.deepEqual(await healthKeys(db), []);
});

test('every export row names a format the axis knows', () => {
  // The factories refuse a missing format when the table is built, so the
  // table importing at all is half the proof; this is the other half.
  assert.equal(EXPORT_ROUTES.length, 14);
  assert.throws(
    () =>
      createExportRoute({
        pattern: /^\/api\/presentations\/([^/]+)\/export\/gif$/,
        buildContent: () => '',
      }),
    /declares no known format \(got 'undefined'\)/,
  );
});

test('a bulk backup counts as export:bulk', async () => {
  const c = exportContext('/api/bulk-export', { method: 'POST' });
  c.req = Readable.from([Buffer.from('{}')]);
  c.req.method = 'POST';
  c.req.headers = { 'content-type': 'application/json' };
  // The backup itself is not what this pins; whatever it answers, the start
  // was an export asked for.
  await handleBulkExport(c).catch(() => {});
  assert.deepEqual(await healthKeys(db, 'export'), ['export:bulk']);
});
