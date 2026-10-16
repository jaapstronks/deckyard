/**
 * A deck that names its theme by slug (B718).
 *
 * Measured on a dev database: 244 decks still said `brand`, `midnight`,
 * `deckyard` or `sandbox-sage`, every one created before migration 085 on an
 * install that never ran the one-time cutover (D237,
 * `scripts/migrate-theme-references.js`). Such a deck fails to open: the theme
 * route refuses the slug with `400 Invalid theme ID`. No deck write stores a
 * slug any more; the library create did, and is closed here.
 *
 * What is pinned:
 * - boot and the doctor name the leftover references and the command;
 * - the thumbnail route answers `thumbnail_unavailable`, not a 400;
 * - after the cutover the deck reads back with the seed's UUID and the warning
 *   is gone;
 * - the library create refuses a slug `themeId`.
 *
 * Run with: node --test tests/theme-slug-references.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMockRes } from './helpers/http-mocks.js';
import { seedRow } from './helpers/theme-seed.js';
import { testScope } from './helpers/storage-scope.js';
import { sessionFor, userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { createPresentation, getPresentation } =
  await import('../server/storage/presentations/index.js');
const { unmigratedThemeReferencesError } =
  await import('../server/db/boot-check.js');
const { themeReferencesCheck } = await import('../server/doctor/database.js');
const { planThemeReferenceMigration } =
  await import('../scripts/migrate-theme-references.js');
const { handlePresentationThumbnail } =
  await import('../server/routes/api/presentations/thumbnail.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handleSlideLibrary } =
  await import('../server/routes/api/slide-library.js');

const midnight = await seedRow('midnight');
const brand = await seedRow('brand');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.beforeEach(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    themes: [brand, midnight],
    users: userRows(OWNER),
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
});

/** A deck as a pre-cutover install holds it: created, then its theme a slug. */
async function slugDeck(slug = 'midnight') {
  const created = await createPresentation(testScope(), {
    title: 'Old deck',
    ownerEmail: OWNER,
    theme: midnight.id,
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hi' } }],
  });
  db.__tables.presentations.find((row) => row.id === created.id).theme = slug;
  return created.id;
}

/** Drive one request through a module dispatcher as the deck owner. */
async function call(dispatcher, method, pathname, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const user = sessionFor(OWNER);
  const res = createMockRes();
  await dispatcher({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(user, { repoRoot: process.cwd() }),
    req: {
      method,
      headers: { host: 'localhost', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        if (payload) yield Buffer.from(payload, 'utf8');
      },
    },
    res,
    url: new URL(`http://localhost${pathname}`),
    authedUser: user,
  });
  return res;
}

test('boot names each leftover slug with its count and the cutover command', async () => {
  assert.equal(await unmigratedThemeReferencesError(), null);
  await slugDeck('midnight');
  await slugDeck('midnight');
  await slugDeck('sandbox-sage');
  db.__tables.slide_library = [{ id: 'lib-1', theme_id: 'brand' }];

  const err = await unmigratedThemeReferencesError();
  assert.ok(err, 'a slug reference is reported');
  assert.match(err, /^4 stored theme references are not/);
  assert.match(err, /"midnight" \(2\), "sandbox-sage" \(1\), "brand" \(1\)/);
  assert.match(err, /scripts\/migrate-theme-references\.js --check/);
});

test('`default`, a UUID and an absent library theme are not reported', async () => {
  await createPresentation(testScope(), {
    title: 'Default deck',
    ownerEmail: OWNER,
    theme: 'default',
    slides: [],
  });
  db.__tables.slide_library = [
    { id: 'lib-1', theme_id: null },
    { id: 'lib-2', theme_id: midnight.id },
  ];
  assert.equal(await unmigratedThemeReferencesError(), null);
});

test('the doctor is red on a leftover slug, green without, skipped before migrations', async () => {
  const results = new Map([['migrations', { status: 'ok', message: '' }]]);
  const red = await themeReferencesCheck.run({
    repoRoot: process.cwd(),
    results,
    unmigratedThemeReferences: async () => '1 stored theme reference is not',
  });
  assert.equal(red.status, 'fail');
  const green = await themeReferencesCheck.run({
    repoRoot: process.cwd(),
    results,
    unmigratedThemeReferences: async () => null,
  });
  assert.equal(green.status, 'ok');
  const skipped = await themeReferencesCheck.run({
    repoRoot: process.cwd(),
    results: new Map([['migrations', { status: 'fail', message: '' }]]),
    unmigratedThemeReferences: async () => assert.fail('must not query'),
  });
  assert.equal(skipped.status, 'skip');
});

test('the thumbnail of a slug deck is thumbnail_unavailable, not a 400', async () => {
  const id = await slugDeck();
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-b718-'));
  const res = createMockRes();
  await handlePresentationThumbnail(
    {
      repoRoot,
      storageScope: testScope(),
      req: { method: 'GET', headers: {} },
      res,
      authedUser: sessionFor(OWNER),
    },
    id,
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'thumbnail_unavailable');
  assert.match(res.json().message, /Invalid theme ID: midnight/);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test('after the cutover the deck reads back with the seed UUID and boot is quiet', async () => {
  const id = await slugDeck();
  // Seed slugs resolve without a map entry: `{}` is the whole map here.
  const plan = await planThemeReferenceMigration(db, {}, ORG);
  assert.equal(plan.ok, true, plan.errors.join('\n'));
  for (const { table, id: rowId, values } of plan.updates) {
    Object.assign(
      db.__tables[table].find((row) => row.id === rowId),
      values,
    );
  }

  assert.equal((await getPresentation(testScope(), id)).theme, midnight.id);
  const res = await call(
    handlePresentations,
    'GET',
    `/api/presentations/${id}`,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().theme, midnight.id);
  assert.equal(await unmigratedThemeReferencesError(), null);
});

test('a library create refuses a slug themeId and takes a UUID or none', async () => {
  const slide = {
    name: 'Saved',
    slideType: 'content-slide',
    content: { title: 'A' },
  };
  const refused = await call(
    handleSlideLibrary,
    'POST',
    '/api/slide-library/personal',
    { ...slide, themeId: 'midnight' },
  );
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().error, 'invalid');
  assert.equal(refused.json().details?.field, 'themeId');
  assert.equal(db.__tables.slide_library?.length ?? 0, 0, 'nothing stored');

  const unknownUuid = await call(
    handleSlideLibrary,
    'POST',
    '/api/slide-library/personal',
    { ...slide, themeId: '99999999-9999-4999-8999-999999999999' },
  );
  assert.equal(unknownUuid.statusCode, 400);

  for (const themeId of [midnight.id, 'default', undefined]) {
    const res = await call(
      handleSlideLibrary,
      'POST',
      '/api/slide-library/personal',
      { ...slide, themeId },
    );
    assert.equal(res.statusCode, 201, String(themeId));
  }
  assert.equal(await unmigratedThemeReferencesError(), null);
});
