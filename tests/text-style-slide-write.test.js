/**
 * The text-style refusal holds on the slide-level write paths (B604). MCP
 * `update_slide`, MCP `add_slide` and v1 `PUT /slides/:slideId` all write
 * through `server/services/slides.js` (B572), and the refusal itself lives in
 * the storage write seam (`normalizeSlides`, B464). Nothing pinned that the
 * seam is still on those paths, so a refactor of the update path could skip it
 * silently. Per contract: a style the type offers is stored; a key it does not
 * offer, and `color`, are refused with the key in the message and nothing is
 * stored.
 *
 * Postgres-mode storage behaviour, so this runs against the in-memory database
 * double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/text-style-slide-write.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b604']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'd0000604-0000-4000-8000-000000000604';
const SLIDE_ID = '51000604-0000-4000-8000-000000000001';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { handleSlides } =
  await import('../server/routes/public-api/v1/slides.js');

const OFFERED = { body: { align: 'center', size: 'lg' } };
const NOT_OFFERED = { subtitle: { size: 'lg' } };
const COLOURED = { body: { color: 'red' } };
const NOT_OFFERED_MESSAGE = /"subtitle" is not offered by this slide type/;
const COLOUR_MESSAGE = /per-field text colour was removed/;

async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [await brandSeedRow()],
    custom_slide_types: [],
    presentations: [
      {
        id: DECK_ID,
        organization_id: ORG,
        owner_email: OWNER,
        created_by: OWNER,
        updated_by: OWNER,
        owner_user_id: userIdFor(OWNER),
        created_by_user_id: userIdFor(OWNER),
        updated_by_user_id: userIdFor(OWNER),
        title: 'A deck',
        theme: 'default',
        lang: 'en-GB',
        visibility: 'private',
        revision: 1,
        slides: [
          {
            id: SLIDE_ID,
            type: 'content-slide',
            content: { title: 'Title', body: 'Body' },
            parentId: null,
          },
        ],
        created_at: '2026-10-01T00:00:00.000Z',
        modified_at: '2026-10-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function storedSlides(db) {
  return db.__tables.presentations.find((row) => row.id === DECK_ID).slides;
}

function mcpTool(name) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const tool = server.tools.get(name);
  assert.ok(tool, `${name} is not registered`);
  return (args) =>
    tool.handler(args, { ownerEmail: OWNER, organizationId: ORG });
}

/** PUT one slide through the v1 router, the key already authenticated. */
async function putSlide(payload) {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
  req.method = 'PUT';
  req.headers = { 'content-type': 'application/json' };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
  await handleSlides({
    req,
    res,
    url: new URL(
      `http://localhost/api/v1/presentations/${DECK_ID}/slides/${SLIDE_ID}`,
    ),
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

test('MCP update_slide stores an offered style and refuses the rest', async () => {
  const db = await installDb();
  const update = (textStyles) =>
    mcpTool('update_slide')({
      presentationId: DECK_ID,
      slideIndex: 0,
      content: { textStyles },
    });

  const before = structuredClone(storedSlides(db));
  await assert.rejects(update(NOT_OFFERED), NOT_OFFERED_MESSAGE);
  await assert.rejects(update(COLOURED), COLOUR_MESSAGE);
  assert.deepEqual(storedSlides(db), before, 'nothing is stored');

  await update(OFFERED);
  assert.deepEqual(storedSlides(db)[0].content.textStyles, OFFERED);
});

test('MCP add_slide stores an offered style and refuses the rest', async () => {
  const db = await installDb();
  const add = (textStyles) =>
    mcpTool('add_slide')({
      presentationId: DECK_ID,
      type: 'content-slide',
      content: { title: 'New', body: 'Added', textStyles },
    });

  await assert.rejects(add(NOT_OFFERED), NOT_OFFERED_MESSAGE);
  await assert.rejects(add(COLOURED), COLOUR_MESSAGE);
  assert.equal(storedSlides(db).length, 1, 'nothing is stored');

  await add(OFFERED);
  const slides = storedSlides(db);
  assert.equal(slides.length, 2);
  assert.deepEqual(slides[1].content.textStyles, OFFERED);
});

test('v1 slide PUT stores an offered style and refuses the rest', async () => {
  const db = await installDb();
  const put = (textStyles) =>
    putSlide({ content: { title: 'Title', body: 'Body', textStyles } });

  const before = structuredClone(storedSlides(db));
  for (const [textStyles, message] of [
    [NOT_OFFERED, NOT_OFFERED_MESSAGE],
    [COLOURED, COLOUR_MESSAGE],
  ]) {
    const res = await put(textStyles);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.match(res.body.message, message);
  }
  assert.deepEqual(storedSlides(db), before, 'nothing is stored');

  const res = await put(OFFERED);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(storedSlides(db)[0].content.textStyles, OFFERED);
});
