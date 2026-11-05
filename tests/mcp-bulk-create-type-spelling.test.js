/**
 * A bulk create accepts every spelling of a slide type that validation
 * accepts (DY-840).
 *
 * `create_presentation_from_slides` in its default `strict` mode validated
 * `type: "title"` (and the canonical `eu.deckyard.slide.title`) through
 * `resolveSlideTypeName()`, then handed the raw spelling to `newSlide`, which
 * only knows registry keys: "Unknown slide type: title", a 500 to the agent.
 * The tool now folds each type to its registry key once, before validation,
 * so the validator and the slide factory read the same name.
 *
 * Run with: node --test tests/mcp-bulk-create-type-spelling.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'dy840']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000ac';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const THEME_ID = '99999999-2222-4333-8444-5555555558a0';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

async function installDb() {
  const db = createFakeDb({
    organizations: [
      {
        id: ORG,
        name: 'Default',
        slug: 'default',
        settings: { defaultThemeId: THEME_ID },
      },
    ],
    users: userRows(OWNER),
    themes: [
      {
        id: THEME_ID,
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
        config: { version: 1 },
        is_default: false,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        created_by: null,
      },
    ],
    custom_slide_types: [],
    presentations: [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function callTool(name, args) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  return server.tools
    .get(name)
    .handler(args, { ownerEmail: OWNER, organizationId: ORG });
}

for (const validation of ['strict', 'fix']) {
  for (const type of ['title', 'eu.deckyard.slide.title', 'title-slide']) {
    test(`a ${validation} bulk create accepts type "${type}"`, async () => {
      const db = await installDb();
      const result = await callTool('create_presentation_from_slides', {
        title: 'Spelling',
        validation,
        slides: [{ type, content: { title: 'Hoi' } }],
      });
      const created = db.__tables.presentations.find((r) => r.id === result.id);
      assert.equal(created.slides[0].type, 'title-slide');
      assert.equal(created.slides[0].content.title, 'Hoi');
      if (validation === 'fix') assert.deepEqual(result.appliedFixes ?? [], []);
    });
  }
}

test('auto_prepend_title sees a folded title spelling as the title slide', async () => {
  const db = await installDb();
  const result = await callTool('create_presentation_from_slides', {
    title: 'Geen dubbele titel',
    auto_prepend_title: true,
    slides: [{ type: 'eu.deckyard.slide.title', content: { title: 'Hoi' } }],
  });
  const created = db.__tables.presentations.find((r) => r.id === result.id);
  assert.equal(created.slides.length, 1);
});

test('an unknown type is refused as bad_request, not a 500', async () => {
  await installDb();
  await assert.rejects(
    () =>
      callTool('create_presentation_from_slides', {
        title: 'Onbekend',
        slides: [{ type: 'nope', content: {} }],
      }),
    (err) => err.statusCode === 400 && /nope/.test(err.message),
  );
});
