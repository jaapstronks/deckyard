/**
 * A gallery an agent creates without `images` gets empty slots, not the
 * editor's demo photos (B866). B862 made that the rule for import and the AI
 * wizard, which compose through `deckToPresentationParts`; MCP
 * `create_presentation_from_slides`/`add_slide` and v1 `POST …/slides` call
 * `newSlide()` directly and kept the demo photos. They now pass
 * `demoPictures: false`, so the slide is incomplete until the author picks a
 * picture. The editor insert keeps them (`deck-import-no-default-pictures`).
 *
 * Run with: node --test tests/agent-gallery-no-default-pictures.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b866']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'd0000866-0000-4000-8000-000000000866';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { handleSlides } =
  await import('../server/routes/public-api/v1/slides.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');
const { isSlideIncomplete } = await import('../shared/incomplete-slides.js');

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
        lang: 'nl',
        visibility: 'private',
        revision: 1,
        slides: [
          {
            id: '11111111-2222-4333-8444-555555555555',
            type: 'title-slide',
            content: { title: 'Hoi' },
            parentId: null,
          },
        ],
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

const deckRow = (db, id = DECK_ID) =>
  db.__tables.presentations.find((row) => row.id === id);

function mcpTool(name) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  return (args) =>
    server.tools
      .get(name)
      .handler(args, { ownerEmail: OWNER, organizationId: ORG });
}

/** Request context for the public-API router, key already authenticated. */
function makeCtx(method, pathname, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
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
  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
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
  };
}

const GALLERY = { type: 'gallery-slide', content: { title: 'Ons team' } };

/** The gallery has slots, none with a picture, and is incomplete. */
function assertEmptySlots(slide) {
  assert.equal(slide.type, 'gallery-slide');
  assert.equal(slide.content.title, 'Ons team');
  assert.ok(slide.content.images.length > 0, 'the empty slots stay');
  assert.deepEqual(
    slide.content.images.map((item) => item.src).filter(Boolean),
    [],
    'no picture comes from the defaults',
  );
  assert.equal(isSlideIncomplete(slide, SLIDE_TYPES), true);
}

test('MCP create_presentation_from_slides (fix): a gallery without images has no demo photos', async () => {
  const db = await installDb();
  const result = await mcpTool('create_presentation_from_slides')({
    title: 'Team',
    validation: 'fix',
    slides: [GALLERY],
  });
  assertEmptySlots(deckRow(db, result.id).slides[0]);
});

test('MCP create_presentation_from_slides (strict): a gallery without images is refused, empty slots are stored', async () => {
  const db = await installDb();
  const create = mcpTool('create_presentation_from_slides');
  await assert.rejects(
    create({ title: 'Team', validation: 'strict', slides: [GALLERY] }),
    /"images" must be array/,
    'strict asks the agent for the list',
  );
  const empty = { src: '', caption: '', alt: '' };
  const result = await create({
    title: 'Team',
    validation: 'strict',
    slides: [
      {
        type: 'gallery-slide',
        content: { title: 'Ons team', images: [empty, empty] },
      },
    ],
  });
  assertEmptySlots(deckRow(db, result.id).slides[0]);
});

test('MCP add_slide: a gallery without images has no demo photos', async () => {
  const db = await installDb();
  await mcpTool('add_slide')({ presentationId: DECK_ID, ...GALLERY });
  assertEmptySlots(deckRow(db).slides.at(-1));
});

test('v1 POST …/slides: a gallery without images has no demo photos', async () => {
  const db = await installDb();
  const ctx = makeCtx(
    'POST',
    `/api/v1/presentations/${DECK_ID}/slides`,
    GALLERY,
  );
  await handleSlides(ctx);
  assert.equal(ctx.res.statusCode, 201, JSON.stringify(ctx.res.body));
  assertEmptySlots(deckRow(db).slides.at(-1));
});

test('MCP add_slide: a gallery the agent fills keeps its own pictures', async () => {
  const db = await installDb();
  await mcpTool('add_slide')({
    presentationId: DECK_ID,
    type: 'gallery-slide',
    content: {
      title: 'Ons team',
      images: [
        { src: '/uploads/a.jpg', caption: 'A', alt: 'A' },
        { src: '/uploads/b.jpg', caption: 'B', alt: 'B' },
      ],
    },
  });
  const slide = deckRow(db).slides.at(-1);
  assert.deepEqual(
    slide.content.images.map((item) => item.src),
    ['/uploads/a.jpg', '/uploads/b.jpg'],
  );
  assert.equal(isSlideIncomplete(slide, SLIDE_TYPES), false);
});
