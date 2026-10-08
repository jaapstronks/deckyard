/**
 * B621: a tool error carries the reasons, not just the sentence.
 *
 * A service refusal is an `AppError` with a machine code and `details`; v1
 * renders it as the envelope `{ error, message, details }`. The MCP tool error
 * renderer used to keep only `err.message`, so a strict-validation refusal of
 * `update_slide` read `Invalid slide data` without saying which field. The
 * renderer now puts the same envelope below the human line, for every tool.
 *
 * Run with: node --test tests/mcp/mcp-tool-error-details.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { userIdFor, userRows } from '../helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b621']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'deck-tool-error';
const SLIDE_ID = '11111111-2222-4333-8444-555555555555';

const { createFakeDb } = await import('../helpers/fake-db.js');
const { __setTestDb } = await import('../../server/db/client.js');
const { initializeStorage } = await import('../../server/storage/lifecycle.js');
const { McpServer } = await import('../../server/mcp/protocol.js');
const { registerTools } = await import('../../server/mcp/tools.js');

async function installDb() {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
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
          lang: 'en',
          visibility: 'private',
          revision: 1,
          slides: [
            {
              id: SLIDE_ID,
              type: 'title-slide',
              content: { title: 'Hello' },
              parentId: null,
            },
          ],
          created_at: '2026-07-01T00:00:00.000Z',
          modified_at: '2026-07-01T00:00:00.000Z',
          trashed_at: null,
        },
      ],
    }),
  );
  await initializeStorage(process.cwd());
}

async function callTool(name, args) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const raw = await server.handleMessage(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    { ownerEmail: OWNER, organizationId: ORG },
  );
  return JSON.parse(raw).result;
}

/** The human line and the envelope below it, as a client reads them. */
function readToolError(result) {
  assert.equal(result.isError, true);
  const [line, ...rest] = result.content[0].text.split('\n');
  return { line, envelope: rest.length ? JSON.parse(rest.join('\n')) : null };
}

test('update_slide with an invalid slide names the failing fields', async () => {
  await installDb();
  const { line, envelope } = readToolError(
    await callTool('update_slide', {
      presentationId: DECK_ID,
      slideIndex: 0,
      content: { title: '' },
    }),
  );
  assert.equal(line, 'Error: Invalid slide data');
  assert.deepEqual(envelope, {
    error: 'bad_request',
    message: 'Invalid slide data',
    details: { errors: ['Slide.content.title is required'] },
  });
});

test('an error without a machine code stays one line', async () => {
  const server = new McpServer();
  server.tool(
    'boom',
    'Throws a plain error',
    { type: 'object', properties: {} },
    async () => {
      throw new Error('Something broke');
    },
    { permission: 'read', readOnly: true },
  );
  const raw = await server.handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'boom', arguments: {} },
  });
  const { line, envelope } = readToolError(JSON.parse(raw).result);
  assert.equal(line, 'Error: Something broke');
  assert.equal(envelope, null);
});
