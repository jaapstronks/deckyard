/**
 * B571: one move-to-trash under three contracts (A7.4).
 *
 * The internal route, public v1 and the MCP `delete_presentation` tool each
 * loaded and trashed a deck their own way: the internal route read a `message`
 * storage never stored and was the only contract to leave an activity row,
 * and MCP answered `deleted: true` for a deck already in the trash. `deletePresentation`
 * in `server/services/presentations.js` now owns the handling; these tests pin
 * that every contract reads the same:
 *
 *   - the owner trashes a deck, and an organization-visible one leaves a
 *     `presentation.deleted` row for the actor (a private one leaves none);
 *   - a reader who is not the owner is refused with 403, also in the MCP
 *     preview, and the deck stays;
 *   - an absent or already-trashed deck is 404.
 *
 * Runs against the in-memory database double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/delete-presentation-service.test.js
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

process.env.AUTH_SECRET = ['deckyard', 'test', 'b571']
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
const { createPresentation } =
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
    title: `Deck (${visibility})`,
    ownerEmail: OWNER,
  });
  // A create is always private; widening it is the visibility route's.
  rowOf(pres.id).visibility = visibility;
  return pres;
}

function rowOf(id) {
  return db.__tables.presentations.find((r) => r.id === id);
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

/** A body-less DELETE request. */
function del() {
  const req = Readable.from([]);
  req.method = 'DELETE';
  req.headers = {};
  return req;
}

/** DELETE through the internal route as `email`'s session. */
async function appDelete(id, email = OWNER) {
  const res = makeRes();
  await handleAppPresentations({
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd()),
    req: del(),
    res,
    url: new URL(`http://test.local/api/presentations/${id}`),
    authedUser: sessionFor(email, { isAdmin: false }),
  });
  return res;
}

/** DELETE through v1 with `email`'s write key. */
async function v1Delete(id, email = OWNER) {
  const res = makeRes();
  await handleV1Presentations({
    req: del(),
    res,
    url: new URL(`http://localhost/api/v1/presentations/${id}`),
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
 * Call `delete_presentation` the way an agent does; `email: null` is a local
 * stdio session without an owner.
 */
function mcpDelete(id, { email = OWNER, confirm = true } = {}) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: email || undefined });
  const tool = server.tools.get('delete_presentation');
  return tool.handler(
    { presentationId: id, confirm },
    email
      ? { ownerEmail: email, organizationId: ORG, userId: userIdFor(email) }
      : { organizationId: ORG },
  );
}

/** The `presentation.deleted` row a trash left, once the write landed. */
async function deletedEvent(presentationId) {
  for (let i = 0; i < 50; i += 1) {
    const row = (db.__tables.activity_events || []).find(
      (e) =>
        e.event_type === 'presentation.deleted' &&
        e.entity_id === presentationId,
    );
    if (row) return row;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return null;
}

/** Assert a contract refused with `status`, as a response or a throw. */
async function assertRefused(where, call, status) {
  if (where === 'MCP') {
    await assert.rejects(call, (err) => {
      assert.equal(err.statusCode, status, `${where}: status`);
      return true;
    });
    return;
  }
  const res = await call();
  assert.equal(res.statusCode, status, `${where}: ${JSON.stringify(res.body)}`);
}

test('the owner trashes on every contract; each trash leaves an activity row', async () => {
  const app = await ownersDeck('organization');
  const v1 = await ownersDeck('organization');
  const mcp = await ownersDeck('organization');

  const appRes = await appDelete(app.id);
  assert.equal(appRes.statusCode, 200, JSON.stringify(appRes.body));
  assert.deepEqual(appRes.body, { ok: true });

  const v1Res = await v1Delete(v1.id);
  assert.equal(v1Res.statusCode, 200, JSON.stringify(v1Res.body));

  assert.deepEqual(await mcpDelete(mcp.id), { deleted: true, id: mcp.id });

  for (const [where, id] of [
    ['internal', app.id],
    ['v1', v1.id],
    ['MCP', mcp.id],
  ]) {
    const row = rowOf(id);
    assert.ok(row.trashed_at, `${where}: in the trash`);
    assert.equal(row.trashed_by, OWNER, `${where}: trashed by`);
    const event = await deletedEvent(id);
    assert.ok(event, `${where}: activity row`);
    assert.equal(event.actor_email, OWNER, `${where}: actor`);
  }
});

test('a private deck goes to the trash without an activity row', async () => {
  const pres = await ownersDeck('private');
  const res = await v1Delete(pres.id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(rowOf(pres.id).trashed_at);
  assert.equal(await deletedEvent(pres.id), null);
});

test('a reader who is not the owner is refused on every contract, preview included', async () => {
  const pres = await ownersDeck('organization');

  await assertRefused('internal', () => appDelete(pres.id, OTHER), 403);
  await assertRefused('v1', () => v1Delete(pres.id, OTHER), 403);
  await assertRefused('MCP', () => mcpDelete(pres.id, { email: OTHER }), 403);
  // The preview used to answer a reader with "set confirm: true".
  await assertRefused(
    'MCP',
    () => mcpDelete(pres.id, { email: OTHER, confirm: false }),
    403,
  );

  assert.equal(rowOf(pres.id).trashed_at ?? null, null, 'the deck stays');
  assert.equal(await deletedEvent(pres.id), null);
});

test('every contract answers an absent or already-trashed deck with 404', async () => {
  const trashed = await ownersDeck('organization');
  assert.equal((await appDelete(trashed.id)).statusCode, 200);

  for (const id of [ABSENT, trashed.id]) {
    await assertRefused('internal', () => appDelete(id), 404);
    await assertRefused('v1', () => v1Delete(id), 404);
    await assertRefused('MCP', () => mcpDelete(id), 404);
  }
});

test('a local MCP session without an owner trashes as the unrestricted operator', async () => {
  const pres = await ownersDeck('private');
  const preview = await mcpDelete(pres.id, { email: null, confirm: false });
  assert.equal(preview.deleted, false);
  assert.equal(preview.title, pres.title);

  assert.deepEqual(await mcpDelete(pres.id, { email: null }), {
    deleted: true,
    id: pres.id,
  });
  assert.ok(rowOf(pres.id).trashed_at);
});
