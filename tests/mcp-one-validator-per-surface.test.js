/**
 * One answer per write surface to "is this content valid" (D121; B257, step
 * B4).
 *
 * MCP `add_slide` and `update_slide` hold an agent's content to the same
 * `validateSlide` the REST contract uses: what is sent is checked, not
 * repaired. They used to run `validateAndFixRefinedSlides` first, which
 * silently switched a list's layout, cut its items to the maximum, recoloured
 * text-block rows. That repair belongs to model output (append, and the opt-in
 * `validation: 'fix'` of a bulk create, which reports what it changed).
 *
 * And every MCP validation reads the deck's theme, so a background variant the
 * theme declares is a value on offer (D88): a bulk create in the default
 * `strict` mode refused one, because no MCP call passed the theme.
 *
 * Run with: node --test tests/mcp-one-validator-per-surface.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b4'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000ab';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'deck-one-validator';
const SLIDE_ID = '11111111-2222-4333-8444-555555555556';
const THEME_RECORD_ID = '99999999-2222-4333-8444-555555555556';
const VARIANT = 'calm';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

/** `n` list items in the type's own shape. */
const listItems = (n) =>
  Array.from({ length: n }, (_, i) => ({ title: `Item ${i + 1}`, text: '' }));
const FIVE_ITEMS = listItems(5);

/** A deck with one list slide, on a default theme that declares one variant. */
async function installDb() {
  const db = createFakeDb({
    organizations: [
      {
        id: ORG,
        name: 'Default',
        slug: 'default',
        settings: { defaultThemeId: THEME_RECORD_ID },
      },
    ],
    users: userRows(OWNER),
    themes: [
      {
        id: THEME_RECORD_ID,
        organization_id: ORG,
        slug: 'ground',
        label: 'Ground',
        logo_url: null,
        logo_small_url: null,
        colors: {
          primary: '#7c3aed',
          background: '#fefefe',
          textLight: '#ffffff',
          textDark: '#1f2937',
        },
        fonts: { heading: 'Montserrat', body: 'Inter' },
        config: {
          version: 1,
          slideBackgrounds: [{ id: VARIANT, label: 'Calm', value: '#e8f0ee' }],
        },
        is_default: false,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        created_by: null,
      },
    ],
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
            id: SLIDE_ID,
            type: 'list-slide',
            content: { title: 'Lijst', items: listItems(2) },
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

function deckSlides(db) {
  return db.__tables.presentations.find((row) => row.id === DECK_ID).slides;
}

function callTool(name, args) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  return server.tools
    .get(name)
    .handler(args, { ownerEmail: OWNER, organizationId: ORG });
}

// ── add_slide / update_slide: checked, not repaired ─────────────────────────

test('add_slide stores the layout the agent chose', async () => {
  const db = await installDb();
  await callTool('add_slide', {
    presentationId: DECK_ID,
    type: 'list-slide',
    content: { title: 'Vijf', items: FIVE_ITEMS, layout: 'one-column' },
  });
  // The fix pipeline switched five items to two columns without saying so.
  assert.equal(deckSlides(db).at(-1).content.layout, 'one-column');
});

test('update_slide stores the layout the agent chose', async () => {
  const db = await installDb();
  await callTool('update_slide', {
    presentationId: DECK_ID,
    slideIndex: 0,
    content: { items: FIVE_ITEMS, layout: 'one-column' },
  });
  assert.equal(deckSlides(db)[0].content.layout, 'one-column');
  assert.deepEqual(deckSlides(db)[0].content.items, FIVE_ITEMS);
});

test('add_slide refuses items past the maximum instead of cutting them', async () => {
  const db = await installDb();
  const items = listItems(9);
  await assert.rejects(
    () =>
      callTool('add_slide', {
        presentationId: DECK_ID,
        type: 'list-slide',
        content: { title: 'Negen', items },
      }),
    (err) =>
      err.statusCode === 400 &&
      err.details?.errors?.some((e) => /items/.test(e)),
  );
  assert.equal(deckSlides(db).length, 1, 'nothing was stored');
});

test('update_slide refuses items past the maximum instead of cutting them', async () => {
  const db = await installDb();
  const items = listItems(9);
  await assert.rejects(
    () =>
      callTool('update_slide', {
        presentationId: DECK_ID,
        slideIndex: 0,
        content: { items },
      }),
    (err) =>
      err.statusCode === 400 &&
      err.details?.errors?.some((e) => /items/.test(e)),
  );
  assert.deepEqual(deckSlides(db)[0].content.items, listItems(2));
});

// ── the theme's background variants are on offer ────────────────────────────

test("a strict bulk create accepts the theme's own background variant", async () => {
  const db = await installDb();
  const result = await callTool('create_presentation_from_slides', {
    title: 'Met variant',
    slides: [
      { type: 'title-slide', content: { title: 'Hoi', background: VARIANT } },
    ],
  });
  const created = db.__tables.presentations.find((row) => row.id === result.id);
  assert.equal(created.slides[0].content.background, VARIANT);
});

test('a strict bulk create still refuses a variant the theme does not declare', async () => {
  await installDb();
  await assert.rejects(
    () =>
      callTool('create_presentation_from_slides', {
        title: 'Zonder variant',
        slides: [
          {
            type: 'title-slide',
            content: { title: 'Hoi', background: 'nowhere' },
          },
        ],
      }),
    /background/,
  );
});

test("add_slide and update_slide accept the theme's own background variant", async () => {
  const db = await installDb();
  await callTool('add_slide', {
    presentationId: DECK_ID,
    type: 'content-slide',
    content: { title: 'Nieuw', background: VARIANT },
  });
  assert.equal(deckSlides(db).at(-1).content.background, VARIANT);
  await callTool('update_slide', {
    presentationId: DECK_ID,
    slideIndex: 0,
    content: { background: VARIANT },
  });
  assert.equal(deckSlides(db)[0].content.background, VARIANT);
});

// ── the guard ───────────────────────────────────────────────────────────────

/** The source of each call to `fn` in `source`, up to its closing paren. */
function calls(source, fn) {
  const out = [];
  let at = source.indexOf(`${fn}(`);
  while (at >= 0) {
    let depth = 0;
    let end = at + fn.length;
    for (; end < source.length; end++) {
      if (source[end] === '(') depth++;
      else if (source[end] === ')' && --depth === 0) break;
    }
    out.push(source.slice(at, end + 1));
    at = source.indexOf(`${fn}(`, end);
  }
  return out;
}

/** Each tool's handler source in `server/mcp/tools.js`, by tool name. */
function toolSources(source) {
  const marks = [...source.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)];
  return Object.fromEntries(
    marks.map((m, i) => [
      m[1],
      source.slice(m.index, marks[i + 1]?.index ?? source.length),
    ]),
  );
}

const TOOLS_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'server', 'mcp', 'tools.js'),
  'utf8',
);

test('every MCP validation passes the deck theme', () => {
  const missing = [];
  for (const fn of [
    'validateAndFixRefinedSlides',
    'validateRefinedSlidesStrict',
  ]) {
    const found = calls(TOOLS_SOURCE, fn);
    assert.ok(found.length > 0, `${fn} is still called in tools.js`);
    for (const call of found) if (!/\btheme\b/.test(call)) missing.push(call);
  }
  assert.deepEqual(missing, [], 'these MCP validations omit the theme');
});

test('the fix pipeline runs only where it repairs model output', () => {
  const tools = toolSources(TOOLS_SOURCE);
  const fixers = Object.entries(tools)
    .filter(([, src]) => src.includes('validateAndFixRefinedSlides('))
    .map(([name]) => name)
    .sort();
  // append: model output; create: the opt-in `validation: 'fix'`, reported in
  // `appliedFixes`; validate_presentation: read-only, it writes nothing.
  assert.deepEqual(fixers, [
    'append_slides',
    'create_presentation_from_slides',
    'validate_presentation',
  ]);
  assert.ok(tools.add_slide, 'add_slide is found');
  assert.ok(tools.update_slide, 'update_slide is found');
});
