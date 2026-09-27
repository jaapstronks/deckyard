/**
 * D92 (2): an MCP `update_slide` is a patch on a slide that exists, not a
 * slide coming into being.
 *
 * A slide is *born* once, in `newSlide()` — defaults, theme seed, instance
 * keys. `update_slide` used to store validated content raw; B243 then routed it
 * through the factory, which would have run the birth steps (a random theme
 * background among them) on every update. The form is: a content update is a
 * patch plus validation, and a type change is a *conversion* through the same
 * `convertSlideToType` the editor uses — so it carries over what maps, re-seeds
 * the rest for the target type, and refuses a pair the model has no mapping
 * for rather than leaving the old type's content under a new name.
 *
 * Run with: node --test tests/mcp-update-slide-is-a-patch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'd92'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'deck-update-slide';
const SLIDE_ID = '11111111-2222-4333-8444-555555555555';
const DEFAULT_RECORD_ID = '99999999-2222-4333-8444-555555555555';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

/** A deck with one title slide, in Dutch, on the default theme. */
async function installDb() {
  const db = createFakeDb({
    organizations: [
      {
        id: ORG,
        name: 'Default',
        slug: 'default',
        settings: { defaultThemeId: DEFAULT_RECORD_ID },
      },
    ],
    users: userRows(OWNER),
    themes: [
      {
        id: DEFAULT_RECORD_ID,
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
        config: { version: 1, defaultBackground: 'mist' },
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
            type: 'title-slide',
            content: { title: 'Hoi', subheading: 'Onder', meta: 'M' },
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

function stored(db) {
  return db.__tables.presentations.find((row) => row.id === DECK_ID).slides[0];
}

function updateSlide(args) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  return server.tools
    .get('update_slide')
    .handler(
      { presentationId: DECK_ID, slideIndex: 0, ...args },
      { ownerEmail: OWNER, organizationId: ORG },
    );
}

test('a content update is a patch: what is not sent stays', async () => {
  const db = await installDb();
  const result = await updateSlide({ content: { subheading: 'Nieuw' } });
  assert.equal(result.updated, true);
  const slide = stored(db);
  assert.equal(slide.type, 'title-slide');
  assert.equal(slide.content.title, 'Hoi');
  assert.equal(slide.content.subheading, 'Nieuw');
  assert.equal(slide.content.meta, 'M');
});

test('a type change is a conversion: what maps carries over, the rest is re-seeded', async () => {
  const db = await installDb();
  const result = await updateSlide({
    type: 'chapter-title-slide',
    content: {},
  });
  assert.equal(result.type, 'chapter-title-slide');
  const slide = stored(db);
  assert.equal(slide.type, 'chapter-title-slide');
  assert.equal(slide.content.title, 'Hoi', 'title maps across');
  assert.equal(slide.content.subheading, 'Onder', 'subheading maps across');
  assert.ok(
    !('meta' in slide.content),
    'a key the target has no field for drops',
  );
  assert.equal(slide.id, SLIDE_ID, 'the same slide, not a new one');
});

test('update_slide conversion uses the scoped default record', async () => {
  const db = await installDb();
  const slide = stored(db);
  slide.type = 'list-slide';
  slide.content = { title: 'List', items: ['One'] };
  await updateSlide({ type: 'content-slide', content: {} });
  assert.equal(stored(db).type, 'content-slide');
  assert.equal(stored(db).content.background, 'mist');
});

test('add_slide composes against the scoped default record', async () => {
  const db = await installDb();
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  await server.tools.get('add_slide').handler(
    {
      presentationId: DECK_ID,
      type: 'content-slide',
      content: { title: 'New' },
    },
    { ownerEmail: OWNER, organizationId: ORG },
  );
  const slides = db.__tables.presentations.find(
    (row) => row.id === DECK_ID,
  ).slides;
  assert.equal(slides.at(-1).content.background, 'mist');
});

test('a type change the model has no mapping for is refused, not stored', async () => {
  const db = await installDb();
  await assert.rejects(
    () => updateSlide({ type: 'poll-slide', content: { question: 'Hm?' } }),
    /no conversion is declared/,
  );
  assert.equal(stored(db).type, 'title-slide');
  assert.equal(stored(db).content.title, 'Hoi');
});

// B260 / D117: the refusal is not a dead end. It names the action that does
// fit - a new slide of the target type, the old one removed or kept as a
// draft - in the tools the agent has, and carries the pair as details.
test('a refused type change names the route and the draft option', async () => {
  await installDb();
  const err = await updateSlide({ type: 'poll-slide', content: {} }).then(
    () => assert.fail('the type change should be refused'),
    (e) => e,
  );
  assert.match(err.message, /from title-slide to poll-slide/);
  assert.match(err.message, /converts only to: chapter-title-slide/);
  assert.match(err.message, /add a poll-slide slide with add_slide/);
  assert.match(err.message, /remove this one with remove_slide/);
  assert.match(err.message, /keep it as a draft with update_slide/);
  assert.match(err.message, /"hideInPresentation":true/);
  assert.deepEqual(err.details, {
    from: 'title-slide',
    to: 'poll-slide',
    convertible: ['chapter-title-slide'],
  });
});

test('the draft the refusal names is reachable: update_slide sets visibility', async () => {
  const db = await installDb();
  const draft = {
    hideInPresentation: true,
    hideInExport: true,
    hideInPublished: true,
    hideFromViewers: false,
  };
  const result = await updateSlide({ content: {}, visibility: draft });
  assert.deepEqual(result.visibility, draft);
  assert.deepEqual(stored(db).visibility, draft);
  assert.equal(stored(db).content.title, 'Hoi', 'content is untouched');
});

test('a malformed visibility is refused, not stored', async () => {
  const db = await installDb();
  await assert.rejects(
    () => updateSlide({ content: {}, visibility: { draft: true } }),
    /Invalid visibility: .*unknown key: draft/,
  );
  await assert.rejects(
    () => updateSlide({ content: {}, visibility: 'draft' }),
    /Invalid visibility: .*must be an object/,
  );
  assert.equal(stored(db).visibility, undefined);
});
