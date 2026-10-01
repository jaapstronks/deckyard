/**
 * B521: one deck create under three contracts (A7.4).
 *
 * The internal route, public v1 and the MCP create tools each made a deck their
 * own way: only the internal route left an activity row, only v1 refused the
 * retired field names and an unsupported `lang`, and an MCP session could hand
 * its new deck to any address through `ownerEmail`. `createPresentation` in
 * `server/services/presentations.js` now owns the handling; these tests pin
 * that every contract reads the same:
 *
 *   - a create leaves a `presentation.created` activity row, whoever asked;
 *   - `themeId` / `language`, an unsupported `lang` and an `ownerEmail` are
 *     refused with 400 and `details.field`, and nothing is written;
 *   - the deck is the actor's.
 *
 * Runs against the in-memory database double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/create-presentation-service.test.js
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

process.env.AUTH_SECRET = ['deckyard', 'test', 'b521']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { listPresentations } =
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

/** POST a body to the internal create route as the session user. */
async function appCreate(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  const res = makeRes();
  await handleAppPresentations({
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd()),
    req,
    res,
    url: new URL('http://test.local/api/presentations'),
    authedUser: sessionFor(OWNER, { isAdmin: false }),
  });
  return res;
}

/** POST a body to v1 create with an authenticated write key. */
async function v1Create(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  const res = makeRes();
  await handleV1Presentations({
    req,
    res,
    url: new URL('http://localhost/api/v1/presentations'),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: userIdFor(OWNER),
      actorEmail: OWNER,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: OWNER,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: {
      id: userIdFor(OWNER),
      email: OWNER,
      role: 'user',
      organizationId: ORG,
    },
  });
  return res;
}

/** Call `create_presentation_from_slides` the way an agent does. */
function mcpCreate(args) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const tool = server.tools.get('create_presentation_from_slides');
  return tool.handler(
    {
      title: 'Van een agent',
      slides: [{ type: 'title-slide', content: { title: 'Hoi' } }],
      ...args,
    },
    { ownerEmail: OWNER, organizationId: ORG, userId: userIdFor(OWNER) },
  );
}

async function decks() {
  return listPresentations(testScope(process.cwd()));
}

/** The activity row a create left, once the fire-and-forget write landed. */
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

test('every contract leaves a presentation.created row for its actor', async () => {
  const app = await appCreate({ title: 'Intern' });
  assert.equal(app.statusCode, 201, JSON.stringify(app.body));

  const v1 = await v1Create({ title: 'Via de API' });
  assert.equal(v1.statusCode, 201, JSON.stringify(v1.body));

  const mcp = await mcpCreate({});

  for (const [where, id] of [
    ['internal', app.body.id],
    ['v1', v1.body.data?.presentation?.id ?? v1.body.presentation?.id],
    ['MCP', mcp.id],
  ]) {
    assert.ok(id, `${where}: created deck id`);
    const row = await createdEvent(id);
    assert.ok(row, `${where}: activity row`);
    assert.equal(row.actor_email, OWNER, `${where}: actor`);
  }
});

/** What a create may not carry, and the field each refusal names. */
const REFUSED = [
  [{ themeId: 'default' }, 'themeId'],
  [{ language: 'nl' }, 'language'],
  [{ lang: 'xx' }, 'lang'],
  [{ ownerEmail: OTHER }, 'ownerEmail'],
];

for (const [extra, field] of REFUSED) {
  test(`every contract refuses ${JSON.stringify(extra)} and writes nothing`, async () => {
    const before = (await decks()).length;

    const app = await appCreate({ title: 'Dek', ...extra });
    assert.equal(app.statusCode, 400, `internal: ${JSON.stringify(app.body)}`);
    assert.equal(app.body.error, 'invalid', 'internal: code');
    assert.equal(app.body.details?.field, field, 'internal: field');

    const v1 = await v1Create({ title: 'Dek', ...extra });
    assert.equal(v1.statusCode, 400, `v1: ${JSON.stringify(v1.body)}`);
    assert.equal(v1.body.details?.field, field, 'v1: field');

    await assert.rejects(
      () => mcpCreate(extra),
      (err) => {
        assert.equal(err.statusCode, 400, 'MCP: status');
        assert.equal(err.details?.field, field, 'MCP: field');
        return true;
      },
    );

    assert.equal((await decks()).length, before);
  });
}

test('the new deck is the actor’s on every contract', async () => {
  const app = await appCreate({ title: 'Van mij' });
  const mcp = await mcpCreate({});
  const byId = new Map((await decks()).map((p) => [p.id, p]));
  assert.equal(byId.get(app.body.id).ownerEmail, OWNER);
  assert.equal(byId.get(mcp.id).ownerEmail, OWNER);
});
