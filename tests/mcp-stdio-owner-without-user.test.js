/**
 * A stdio session whose owner has no user row refuses to start (DY-843).
 *
 * With DECKYARD_MCP_OWNER_EMAIL set to an address no `users` row carries, a
 * create succeeded and stamped the deck with no owner id; ownership is
 * decided on that id, so every later read was `forbidden` without a hint.
 * The first test pins that mechanism, the rest the refusal that now stops
 * the stdio entrypoint before it serves.
 *
 * Run with: node --test tests/mcp-stdio-owner-without-user.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'dy843']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000ad';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'solo@example.com';
const THEME_ID = '99999999-2222-4333-8444-5555555558a1';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { singleOrganizationScope } = await import('../server/storage/scope.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { stdioOwnerError } =
  await import('../server/mcp/presentation-access.js');

async function installDb({ withOwner }) {
  const db = createFakeDb({
    organizations: [
      {
        id: ORG,
        name: 'Default',
        slug: 'default',
        settings: { defaultThemeId: THEME_ID },
      },
    ],
    users: withOwner ? userRows(OWNER) : [],
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
        fonts: { heading: 'Inter', body: 'Inter' },
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

/** The scope the stdio entrypoint checks in, as `server/mcp/index.js` builds it. */
const stdioScope = (email) =>
  singleOrganizationScope(process.cwd(), 'MCP stdio session', {
    actorEmail: email,
  });

/** Create a deck as a stdio session owned by `OWNER`, then read it back. */
async function createThenRead() {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const created = await server.tools
    .get('create_presentation_from_slides')
    .handler(
      {
        title: 'Solo',
        slides: [{ type: 'title-slide', content: { title: 'Hoi' } }],
      },
      {},
    );
  return server.tools
    .get('get_presentation')
    .handler({ presentationId: created.id }, {});
}

test('the mechanism: without a user row the created deck is unreadable', async () => {
  await installDb({ withOwner: false });
  await assert.rejects(createThenRead, (err) => err.statusCode === 403);
});

test('with a user row the same session reads its own deck', async () => {
  await installDb({ withOwner: true });
  assert.ok(await createThenRead());
});

test('the stdio check refuses an owner without a user row, by name', async () => {
  await installDb({ withOwner: false });
  const message = await stdioOwnerError(stdioScope(OWNER), OWNER);
  assert.match(message, /DECKYARD_MCP_OWNER_EMAIL/);
  assert.match(message, /solo@example\.com/);
  assert.match(message, /no user/);
});

test('the stdio check passes an existing owner, any letter case', async () => {
  await installDb({ withOwner: true });
  assert.equal(await stdioOwnerError(stdioScope(OWNER), OWNER), null);
  assert.equal(
    await stdioOwnerError(stdioScope('Solo@Example.com'), 'Solo@Example.com'),
    null,
  );
});

test('the stdio check passes a session without an owner (local operator)', async () => {
  await installDb({ withOwner: false });
  assert.equal(await stdioOwnerError(stdioScope(null), null), null);
});

test('the stdio entrypoint asks before it builds the server', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'server/mcp/index.js'),
    'utf8',
  );
  const asked = source.indexOf('await stdioOwnerError(');
  assert.ok(asked > 0, 'index.js calls stdioOwnerError');
  assert.ok(
    asked < source.indexOf('await buildServer({ defaultOwnerEmail })'),
    'the check runs before the server is built',
  );
});
