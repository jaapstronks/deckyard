/**
 * B131: the per-slide public API and the MCP write tools know the org registry.
 *
 * B129 taught the storage write seam (`normalizeSlides`) to resolve a slide
 * type against the organization's registry rather than the process-wide
 * `SLIDE_TYPES` map, which cannot hold a per-organization DB row. Two write
 * surfaces in front of that seam still resolved against the global map, so a
 * type the Settings → Slide Types builder had published was refused before its
 * content was ever read:
 *
 * - `POST/PUT /api/v1/presentations/:id/slides` resolved the type and then
 *   validated the slide, both against the global map — a 400 on a type the
 *   organization owns, and the same 400 on the way in as on a typo.
 * - `create_presentation_from_slides` handed strict and fix validation no
 *   registry at all, so strict threw `unknown slide type` and fix silently
 *   applied no declarations.
 *
 * The fix is not a tolerance for `custom-` ids: it is that both surfaces build
 * the same `buildMergedSlideTypes(scope)` every read path already used, so a
 * published type is known and everything else is still refused. Both halves
 * are pinned here, plus a source-level guard that a new call site cannot
 * quietly go back to the global map.
 *
 * Postgres-mode storage behaviour, so this runs against the in-memory database
 * double (tests/helpers/fake-db.js), the same harness as
 * custom-slide-type-write-seam.
 *
 * Run with: node --test tests/org-registry-write-surfaces.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { walkJsFiles, callArguments } from './helpers/call-sites.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b131']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
const OWNER = 'owner@example.com';
const DECK_ID = 'deck-org-registry';
/** The key the builder publishes a type under, and the editor inserts. */
const CUSTOM_TYPE = 'custom-partner-wall';
/** The custom type's own `maxLength` on `title`. */
const TITLE_CAP = 12;
/** `validateSlide` requires a UUID, so the seeded slide carries a real one. */
const SLIDE_ID = '11111111-2222-4333-8444-555555555555';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handleSlides } =
  await import('../server/routes/public-api/v1/slides.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

/**
 * One published `custom_slide_types` row: a single `title` string field, so a
 * slide of it is valid with `{ title: '…' }` and nothing else. The `maxLength`
 * is what makes the fix branch measurable — it repairs rather than refuses, so
 * "it went through" proves nothing on its own; a title cut to this cap proves
 * the declaration came out of the organization's registry.
 * @param {object} over - Column overrides
 * @returns {object}
 */
function customTypeRow(over = {}) {
  return {
    id: 'cst-partner-wall',
    organization_id: ORG,
    slug: 'partner-wall',
    label: 'Partner wall',
    base_type: null,
    fields: [
      { key: 'title', type: 'string', label: 'Titel', maxLength: TITLE_CAP },
    ],
    defaults: { title: '' },
    defaults_by_lang: null,
    template: '<div class="slide"><h2>{{esc title}}</h2></div>',
    css: null,
    usage: null,
    is_published: true,
    sort_order: 0,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    created_by: null,
    ...over,
  };
}

/** Install a freshly seeded double and point the storage facade at Postgres. */
async function installDb(customSlideTypes = [customTypeRow()]) {
  const db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: userRows(OWNER),
    custom_slide_types: customSlideTypes,
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
            id: SLIDE_ID,
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

/** The stored row, straight from the double. */
function storedDeck(db) {
  return db.__tables.presentations.find((row) => row.id === DECK_ID);
}

/** Request context for the public-API router, key already authenticated. */
function makeCtx(method, pathname, body = null) {
  const req = Readable.from(
    body === null ? [] : [Buffer.from(JSON.stringify(body))],
  );
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

/** POST a new slide of `type` onto the seeded deck. */
async function postSlide(type) {
  const ctx = makeCtx('POST', `/api/v1/presentations/${DECK_ID}/slides`, {
    type,
    content: { title: 'Partners' },
  });
  await handleSlides(ctx);
  return ctx.res;
}

/** PUT the seeded deck's only slide as `type`. */
async function putSlide(type) {
  const ctx = makeCtx(
    'PUT',
    `/api/v1/presentations/${DECK_ID}/slides/${SLIDE_ID}`,
    { type, content: { title: 'Partners' } },
  );
  await handleSlides(ctx);
  return ctx.res;
}

/** The MCP tool handler under test, with an SSE-shaped session context. */
function mcpTool(name) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const tool = server.tools.get(name);
  assert.ok(tool, `${name} is not registered`);
  return (args) =>
    tool.handler(args, { ownerEmail: OWNER, organizationId: ORG });
}

/** create_presentation_from_slides with one slide of `type`. */
function createFromSlides(type, validation) {
  return mcpTool('create_presentation_from_slides')({
    title: 'From slides',
    validation,
    slides: [{ type, content: { title: 'Partners' } }],
  });
}

// ── the public API's per-slide surface ──────────────────────────────────────

test('POST …/slides creates a slide of a published custom type', async () => {
  const db = await installDb();

  const res = await postSlide(CUSTOM_TYPE);

  assert.equal(
    res.statusCode,
    201,
    `expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`,
  );
  const slides = storedDeck(db).slides;
  assert.equal(slides.length, 2);
  assert.equal(
    slides[1].type,
    CUSTOM_TYPE,
    'the custom type is stored under its own key, unchanged',
  );
  assert.equal(slides[1].content.title, 'Partners');
});

test('PUT …/slides/:id retypes a slide to a published custom type', async () => {
  const db = await installDb();

  const res = await putSlide(CUSTOM_TYPE);

  assert.equal(
    res.statusCode,
    200,
    `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`,
  );
  assert.equal(storedDeck(db).slides[0].type, CUSTOM_TYPE);
});

test('the per-slide surface still refuses what the org does not own', async () => {
  for (const rows of [
    [customTypeRow({ is_published: false })],
    [customTypeRow({ organization_id: OTHER_ORG })],
  ]) {
    const db = await installDb(rows);
    assert.equal((await postSlide(CUSTOM_TYPE)).statusCode, 400);
    assert.equal((await putSlide(CUSTOM_TYPE)).statusCode, 400);
    assert.equal(storedDeck(db).slides.length, 1, 'nothing was written');
    assert.equal(storedDeck(db).slides[0].type, 'title-slide');
  }

  const db = await installDb();
  for (const type of ['custom-not-a-type', 'not-a-real-type']) {
    assert.equal((await postSlide(type)).statusCode, 400, type);
    assert.equal((await putSlide(type)).statusCode, 400, type);
  }
  assert.equal(storedDeck(db).slides.length, 1);
});

// ── the MCP write surface ───────────────────────────────────────────────────

for (const validation of ['strict', 'fix']) {
  test(`create_presentation_from_slides (${validation}) accepts a published custom type`, async () => {
    const db = await installDb();

    const result = await createFromSlides(CUSTOM_TYPE, validation);

    assert.ok(result?.id, JSON.stringify(result));
    const created = db.__tables.presentations.find(
      (row) => row.id === result.id,
    );
    assert.equal(created.slides[0].type, CUSTOM_TYPE);
    assert.equal(created.slides[0].content.title, 'Partners');
  });

  test(`create_presentation_from_slides (${validation}) still refuses an unknown type`, async () => {
    await installDb([customTypeRow({ organization_id: OTHER_ORG })]);

    await assert.rejects(
      () => createFromSlides(CUSTOM_TYPE, validation),
      /unknown slide type|Unknown slide type|Validation failed/,
      'a type this organization does not own is refused',
    );
  });
}

test("the fix branch reads the custom type's own declarations", async () => {
  const db = await installDb();

  const result = await mcpTool('create_presentation_from_slides')({
    title: 'From slides',
    validation: 'fix',
    slides: [
      {
        type: CUSTOM_TYPE,
        content: { title: 'A partner wall title far past the cap' },
      },
    ],
  });

  const created = db.__tables.presentations.find((row) => row.id === result.id);
  const title = created.slides[0].content.title;
  assert.ok(
    title.length <= TITLE_CAP,
    `expected the title truncated to ${TITLE_CAP}, got ${JSON.stringify(title)}`,
  );
  assert.ok(
    result.appliedFixes.some((fix) => fix.field === 'title'),
    `expected a reported fix on title, got ${JSON.stringify(result.appliedFixes)}`,
  );
});

// ── the guard ───────────────────────────────────────────────────────────────

/**
 * The seams that refuse a slide type, and what "passes a registry" means for
 * each: a positional second argument, or a `slideTypes` key in the options
 * object. `newSlide` takes one options object, so the registry rides in that.
 *
 * The fix pipeline's own entry points are listed for `server/mcp` only. The
 * three `server/routes/api/ai` callers still read the global map; that is
 * B247, and unlike the seams here it degrades (no declarations applied) rather
 * than refusing, so it is not what B131 pinned.
 */
const SEAMS = [
  { fn: 'resolveSlideTypeName', dirs: ['routes', 'mcp'], at: 1 },
  { fn: 'getSlideType', dirs: ['routes', 'mcp'], at: 1 },
  { fn: 'validateSlide', dirs: ['routes', 'mcp'], at: 1 },
  { fn: 'newSlide', dirs: ['routes', 'mcp'], at: 0 },
  { fn: 'validateRefinedSlidesStrict', dirs: ['mcp'], at: 1 },
  { fn: 'validateAndFixRefinedSlides', dirs: ['mcp'], at: 1 },
];

test('no write surface resolves a slide type against the global registry', () => {
  const offenders = [];
  for (const { fn, dirs, at } of SEAMS) {
    for (const dir of dirs) {
      const root = path.join(process.cwd(), 'server', dir);
      for (const file of walkJsFiles(root)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const args of callArguments(source, fn)) {
          const arg = args[at];
          if (!arg || !arg.includes('slideTypes')) {
            offenders.push(
              `${path.relative(process.cwd(), file)}: ${fn}(${args.join(', ')})`,
            );
          }
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these call sites resolve against the process-wide SLIDE_TYPES map instead of the caller's registry:\n${offenders.join('\n')}`,
  );
});

test('the guard would catch a call site that drops the registry', () => {
  const source = `resolveSlideTypeName(body.type);\nnewSlide({ type, theme });\n`;
  assert.deepEqual(callArguments(source, 'resolveSlideTypeName'), [
    ['body.type'],
  ]);
  assert.equal(
    callArguments(source, 'newSlide')[0][0].includes('slideTypes'),
    false,
  );
});
