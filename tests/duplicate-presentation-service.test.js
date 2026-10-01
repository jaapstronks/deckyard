/**
 * B570: one deck copy under three contracts (A7.4).
 *
 * The internal route, public v1 and the MCP `duplicate_presentation` tool each
 * copied a deck their own way: each loaded and decided beside the copy, MCP
 * handed storage an `ownerEmail` it never read, v1 answered a source that was
 * gone by then with a 500, and no contract left an activity row for the deck
 * it had just made. `duplicatePresentation` in `server/services/presentations.js`
 * now owns the handling; these tests pin that every contract reads the same:
 *
 *   - whoever may read a deck may copy it, and the copy is theirs;
 *   - a copy leaves a `presentation.created` row for the actor;
 *   - an unreadable deck is 403 and an absent one 404, and nothing is written.
 *
 * Runs against the in-memory database double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/duplicate-presentation-service.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { testScope } from './helpers/storage-scope.js';
import { seedRow } from './helpers/theme-seed.js';
import {
  sessionFor,
  userIdFor,
  userRows,
} from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b570']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';
const ABSENT = '00000000-0000-4000-8000-00000000dead';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, listPresentations } =
  await import('../server/storage/presentations/index.js');
const { handlePresentations: handleAppPresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handlePresentations: handleV1Presentations } =
  await import('../server/routes/public-api/v1/presentations.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER, OTHER),
    themes: [await seedRow('brand')],
    activity_events: [],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** A deck of OWNER's, readable by the organization or by OWNER alone. */
async function ownersDeck(visibility) {
  const pres = await createPresentation(testScope(process.cwd()), {
    title: `Bron (${visibility})`,
    ownerEmail: OWNER,
  });
  // A create is always private; widening it is the visibility route's.
  const row = db.__tables.presentations.find((r) => r.id === pres.id);
  row.visibility = visibility;
  return pres;
}

/** A recorder for a route's response. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

/** A body-less POST request. */
function post() {
  const req = Readable.from([]);
  req.method = 'POST';
  req.headers = {};
  return req;
}

/** POST to the internal duplicate route as `email`'s session. */
async function appDuplicate(id, email = OTHER) {
  const res = makeRes();
  await handleAppPresentations({
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd()),
    req: post(),
    res,
    url: new URL(`http://test.local/api/presentations/${id}/duplicate`),
    authedUser: sessionFor(email, { isAdmin: false }),
  });
  return res;
}

/** POST to v1 duplicate with `email`'s write key. */
async function v1Duplicate(id, email = OTHER) {
  const res = makeRes();
  await handleV1Presentations({
    req: post(),
    res,
    url: new URL(`http://localhost/api/v1/presentations/${id}/duplicate`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: userIdFor(email),
      actorEmail: email,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: email,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: {
      id: userIdFor(email),
      email,
      role: 'user',
      organizationId: ORG,
    },
  });
  return res;
}

/**
 * Call `duplicate_presentation` the way an agent does; `email: null` is a
 * local stdio session without an owner.
 */
function mcpDuplicate(id, email = OTHER) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: email || undefined });
  const tool = server.tools.get('duplicate_presentation');
  return tool.handler(
    { presentationId: id },
    email
      ? { ownerEmail: email, organizationId: ORG, userId: userIdFor(email) }
      : { organizationId: ORG },
  );
}

async function decks() {
  return listPresentations(testScope(process.cwd()));
}

/** The activity row a copy left, once the fire-and-forget write landed. */
async function createdEvent(presentationId) {
  for (let i = 0; i < 50; i += 1) {
    const row = (db.__tables.activity_events || []).find(
      (e) =>
        e.event_type === 'presentation.created' &&
        e.presentation_id === presentationId,
    );
    if (row) return row;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return null;
}

test('a reader copies on every contract; the copy and its activity row are theirs', async () => {
  const source = await ownersDeck('organization');

  const app = await appDuplicate(source.id);
  assert.equal(app.statusCode, 201, JSON.stringify(app.body));

  const v1 = await v1Duplicate(source.id);
  assert.equal(v1.statusCode, 201, JSON.stringify(v1.body));

  const mcp = await mcpDuplicate(source.id);

  const byId = new Map((await decks()).map((p) => [p.id, p]));
  for (const [where, id] of [
    ['internal', app.body.id],
    ['v1', v1.body.data?.presentation?.id ?? v1.body.presentation?.id],
    ['MCP', mcp.id],
  ]) {
    assert.ok(id, `${where}: copy id`);
    assert.notEqual(id, source.id, `${where}: a new deck`);
    assert.equal(byId.get(id)?.ownerEmail, OTHER, `${where}: owner`);
    const row = await createdEvent(id);
    assert.ok(row, `${where}: activity row`);
    assert.equal(row.actor_email, OTHER, `${where}: actor`);
  }
});

test('every contract refuses a deck the actor may not read, and copies nothing', async () => {
  const source = await ownersDeck('private');
  const before = (await decks()).length;

  const app = await appDuplicate(source.id);
  assert.equal(app.statusCode, 403, `internal: ${JSON.stringify(app.body)}`);

  const v1 = await v1Duplicate(source.id);
  assert.equal(v1.statusCode, 403, `v1: ${JSON.stringify(v1.body)}`);

  await assert.rejects(
    () => mcpDuplicate(source.id),
    (err) => {
      assert.equal(err.statusCode, 403, 'MCP: status');
      return true;
    },
  );

  assert.equal((await decks()).length, before);
});

test('every contract answers an absent deck with 404', async () => {
  const before = (await decks()).length;

  const app = await appDuplicate(ABSENT);
  assert.equal(app.statusCode, 404, `internal: ${JSON.stringify(app.body)}`);

  // v1 answered a source it could not copy with a 500.
  const v1 = await v1Duplicate(ABSENT);
  assert.equal(v1.statusCode, 404, `v1: ${JSON.stringify(v1.body)}`);

  await assert.rejects(
    () => mcpDuplicate(ABSENT),
    (err) => {
      assert.equal(err.statusCode, 404, 'MCP: status');
      return true;
    },
  );

  assert.equal((await decks()).length, before);
});

test('a local MCP session without an owner copies as the unrestricted operator', async () => {
  const source = await ownersDeck('private');
  const copy = await mcpDuplicate(source.id, null);
  const stored = (await decks()).find((p) => p.id === copy.id);
  assert.ok(stored, 'the copy exists');
  assert.equal(stored.ownerEmail ?? null, null, 'nobody owns it');
});
