/**
 * One mapper for the fields a deck card needs and no query stores.
 *
 * Five endpoints hand the grid a list of presentations — the collection,
 * shared-with-me, popular (also folded into `/api/home`), the trash, and the
 * 201 from a duplicate — and one component renders all of them. `thumbBg` (the
 * theme-colored placeholder shown until the raster loads) was attached by the
 * collection route only, so every other surface rendered a colorless card. This
 * file pins the shared mapper and that each producer routes through it.
 *
 * In its own file so the shared theme cache stays clean — route tests elsewhere
 * load themes from throwaway repo roots, which would poison a shared process.
 *
 * Run with: node --test tests/deck-card-fields.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withDeckCardFields } from '../server/utils/deck-card-fields.js';
import { testScope } from './helpers/storage-scope.js';
import { sessionFor, userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, deletePresentation } =
  await import('../server/storage/presentations/index.js');
const { handlePresentationsList } =
  await import('../server/routes/api/presentations/list.js');
const { handlePresentationsTrashList } =
  await import('../server/routes/api/presentations/trash.js');
const { handlePresentationDuplicate } =
  await import('../server/routes/api/presentations/duplicate.js');
const { ROUTES: COLLABORATOR_ROUTES } =
  await import('../server/routes/api/collaborators.js');
const { addCollaborator } = await import('../server/storage/collaborators.js');

const handleSharedWithMe = COLLABORATOR_ROUTES.find(
  (r) => r.pattern === '/api/presentations/shared-with-me',
).handler;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const OWNER = 'owner@example.com';
const PARTNER = 'partner@example.com';

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER, PARTNER),
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** Collect a route's JSON body. */
function mockRes() {
  return {
    statusCode: null,
    chunks: [],
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    setHeader() {},
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
    },
    get json() {
      try {
        return JSON.parse(this.chunks.join(''));
      } catch {
        return null;
      }
    },
  };
}

const deckFor = (title, overrides = {}) => ({
  title,
  ownerEmail: OWNER,
  theme: 'amethyst',
  slides: [{ id: 's1', type: 'title-slide', content: { title } }],
  ...overrides,
});

// ── The mapper ──────────────────────────────────────────────────────────────

test('withDeckCardFields attaches the theme background per item', async () => {
  const [a, b] = await withDeckCardFields(repoRoot, [
    { id: 'a', theme: 'amethyst' },
    { id: 'b', theme: 'amethyst' },
  ]);
  assert.match(a.thumbBg || '', /^#[0-9a-f]{3,6}$/i, 'a hex for a known theme');
  assert.equal(b.thumbBg, a.thumbBg, 'one lookup, same answer for both');
});

test('withDeckCardFields keeps every field the producer built', async () => {
  const [item] = await withDeckCardFields(repoRoot, [
    { id: 'a', theme: 'amethyst', activityCount: 3 },
  ]);
  assert.equal(item.id, 'a');
  assert.equal(item.activityCount, 3, 'producer-specific fields survive');
});

test('withDeckCardFields tolerates a themeless or empty list', async () => {
  assert.deepEqual(await withDeckCardFields(repoRoot, []), []);
  assert.deepEqual(await withDeckCardFields(repoRoot, null), []);
  const [item] = await withDeckCardFields(repoRoot, [{ id: 'a' }]);
  assert.equal(item.thumbBg, null, 'no theme, no color — never undefined');
});

// ── The producers ───────────────────────────────────────────────────────────

test('the collection route ships thumbBg', async () => {
  await createPresentation(testScope(), deckFor('Collection deck'));

  const res = mockRes();
  await handlePresentationsList({
    repoRoot,
    storageScope: testScope(),
    res,
    authedUser: sessionFor(OWNER),
  });
  const item = res.json.find((p) => p.title === 'Collection deck');
  assert.ok(item, 'deck is listed');
  assert.match(item.thumbBg || '', /^#[0-9a-f]{3,6}$/i);
});

test('shared-with-me ships thumbBg', async () => {
  const created = await createPresentation(
    testScope(),
    deckFor('Shared deck', { visibility: 'private' }),
  );
  const invited = await addCollaborator(created.id, {
    userEmail: PARTNER,
    permission: 'edit',
    invitedBy: OWNER,
  });
  assert.equal(invited.ok, true, 'the partner holds a row on the deck');

  const res = mockRes();
  await handleSharedWithMe({
    repoRoot,
    storageScope: testScope(sessionFor(PARTNER)),
    res,
    authedUser: sessionFor(PARTNER),
  });
  const item = res.json.presentations.find((p) => p.title === 'Shared deck');
  assert.ok(item, 'deck is shared with the partner');
  assert.match(item.thumbBg || '', /^#[0-9a-f]{3,6}$/i);
});

test('the trash route ships thumbBg', async () => {
  const created = await createPresentation(
    testScope(),
    deckFor('Trashed deck'),
  );
  await deletePresentation(testScope(), created.id, { actorEmail: OWNER });

  const res = mockRes();
  await handlePresentationsTrashList({
    repoRoot,
    storageScope: testScope(),
    req: { method: 'GET' },
    res,
    authedUser: sessionFor(OWNER),
  });
  const item = res.json.find((p) => p.title === 'Trashed deck');
  assert.ok(item, 'deck is in the trash');
  assert.match(item.thumbBg || '', /^#[0-9a-f]{3,6}$/i);
});

test('a duplicate answers with a card-ready item', async () => {
  const created = await createPresentation(testScope(), deckFor('Original'));

  const res = mockRes();
  await handlePresentationDuplicate(
    {
      repoRoot,
      storageScope: testScope(),
      req: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        async *[Symbol.asyncIterator]() {},
      },
      res,
      authedUser: sessionFor(OWNER),
    },
    created.id,
  );
  assert.equal(res.statusCode, 201);
  assert.match(
    res.json.thumbBg || '',
    /^#[0-9a-f]{3,6}$/i,
    'the card rendered straight from this response is not the one colorless one',
  );
});

// ── The producer that a fake database cannot reach ──────────────────────────

/**
 * `/api/presentations/popular` is the fifth producer and the one endpoint this
 * file cannot drive: its query groups, `having`s and joins on a callback, which
 * the in-memory double does not model. A source-level guard covers it instead —
 * the point is only that the route goes through the shared mapper rather than
 * growing a `thumbBg` of its own, and that is visible in the source.
 */
test('every list-producing route goes through the shared mapper', () => {
  const producers = [
    'server/routes/api/presentations/list.js',
    'server/routes/api/presentations/popular.js',
    'server/routes/api/presentations/trash.js',
    'server/routes/api/presentations/duplicate.js',
    'server/routes/api/collaborators.js',
  ];
  for (const relative of producers) {
    const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.match(
      source,
      /withDeckCardFields\(/,
      `${relative} must build its deck cards through the shared mapper`,
    );
    assert.doesNotMatch(
      source,
      /thumbBg:/,
      `${relative} must not spell out a deck-card field of its own`,
    );
  }
});
