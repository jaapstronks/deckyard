/**
 * An MCP client that follows `get_slide_types` can style text, and one that
 * does not is told why (B464 PR 3). `create_presentation_from_slides` in
 * strict mode used to refuse `textStyles` as an unknown field before the write
 * seam saw it; now the strict check knows the key on a type that offers
 * styling, and the seam (`normalizeSlides`) answers the rest with the message
 * that names the key.
 *
 * Postgres-mode storage behaviour, so this runs against the in-memory database
 * double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/text-style-mcp-write.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b464']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [await brandSeedRow()],
    custom_slide_types: [],
    presentations: [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function mcpTool(name) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const tool = server.tools.get(name);
  assert.ok(tool, `${name} is not registered`);
  return (args) =>
    tool.handler(args, { ownerEmail: OWNER, organizationId: ORG });
}

function createWithStyles(textStyles) {
  return mcpTool('create_presentation_from_slides')({
    title: 'Styled',
    validation: 'strict',
    slides: [
      {
        type: 'content-slide',
        content: { title: 'Title', body: 'Body', textStyles },
      },
    ],
  });
}

test('a style get_slide_types lists is stored', async () => {
  const db = await installDb();
  const { types } = await mcpTool('get_slide_types')({ lang: 'en-GB' });
  assert.deepEqual(Object.keys(types['content-slide'].textStyles), [
    'title',
    'body',
  ]);
  await createWithStyles({ body: { align: 'center', size: 'lg' } });
  const [row] = db.__tables.presentations;
  const slide = row.slides.find((s) => s.type === 'content-slide');
  assert.deepEqual(slide.content.textStyles, {
    body: { align: 'center', size: 'lg' },
  });
});

test('a style it does not list is refused, naming the key', async () => {
  const db = await installDb();
  await assert.rejects(
    createWithStyles({ subtitle: { size: 'lg' } }),
    /"subtitle" is not offered by this slide type/,
  );
  await assert.rejects(
    createWithStyles({ body: { color: 'red' } }),
    /per-field text colour was removed/,
  );
  assert.equal(db.__tables.presentations.length, 0);
});
