/**
 * B621: a tool error carries the reasons, not just the sentence.
 *
 * A service refusal is an `AppError` with a machine code and `details`; v1
 * renders it as the envelope `{ error, message, details }`. The MCP tool error
 * renderer used to keep only `err.message`, so a strict-validation refusal of
 * `update_slide` read `Invalid slide data` without saying which field. The
 * renderer now puts the same envelope below the human line, for every tool.
 *
 * B624: and like v1 it keeps an unexpected failure's message to the log.
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
const { NotFoundError } = await import('../../server/utils/errors.js');

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

/** Call a one-off tool that throws `err`, as a client reads the failure. */
async function throwFromTool(err) {
  const server = new McpServer();
  server.tool(
    'boom',
    'Throws the given error',
    { type: 'object', properties: {} },
    async () => {
      throw err;
    },
    { permission: 'read', readOnly: true },
  );
  const raw = await server.handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'boom', arguments: {} },
  });
  return readToolError(JSON.parse(raw).result);
}

/** Run `fn` with `console.error` captured, so a logged failure stays quiet. */
async function capturingErrors(fn) {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}

// B624: the same rule as v1's `withV1ErrorHandler`. An unexpected failure's
// message is internal detail; the caller gets a fixed sentence, the log the
// rest. A sentence written for the caller (any `AppError`) still reaches it.

test('a plain error does not leak its message', async () => {
  const { result, logged } = await capturingErrors(() =>
    throwFromTool(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
  );
  assert.equal(result.line, 'Error: Internal server error');
  assert.equal(result.envelope, null);
  assert.ok(
    logged.some((args) => args.some((a) => a?.message?.includes('10.0.0.5'))),
    'the internal failure is logged',
  );
});

test('a 5xx error that is not an AppError does not leak its message', async () => {
  const err = Object.assign(new Error('pool exhausted at db-2'), {
    statusCode: 503,
  });
  const { result } = await capturingErrors(() => throwFromTool(err));
  assert.equal(result.line, 'Error: Internal server error');
  assert.equal(result.envelope, null);
});

test('a 4xx AppError keeps its sentence and envelope', async () => {
  const { line, envelope } = await throwFromTool(
    new NotFoundError('Presentation not found'),
  );
  assert.equal(line, 'Error: Presentation not found');
  assert.deepEqual(envelope, {
    error: 'not_found',
    message: 'Presentation not found',
  });
});

test('a tool refusal with a meant sentence travels as a 4xx', async () => {
  await installDb();
  const { line, envelope } = readToolError(
    await callTool('update_slide', {
      presentationId: DECK_ID,
      slideIndex: 5,
      content: { title: 'Hi' },
    }),
  );
  assert.equal(line, 'Error: Slide index 5 out of range (0-0)');
  assert.equal(envelope.error, 'bad_request');

  const missing = readToolError(
    await callTool('update_slide', { slideIndex: 0, content: {} }),
  );
  assert.equal(
    missing.line,
    'Error: A presentation id is required (pass `id` or `presentationId`).',
  );
  assert.equal(missing.envelope.error, 'bad_request');
});

test('a refused slide-type change names the pair in its details', async () => {
  await installDb();
  const { envelope } = readToolError(
    await callTool('update_slide', {
      presentationId: DECK_ID,
      slideIndex: 0,
      type: 'quote-slide',
      content: { quote: 'Hi' },
    }),
  );
  assert.equal(envelope.error, 'unsupported_conversion');
  assert.deepEqual(Object.keys(envelope.details).sort(), [
    'convertible',
    'from',
    'to',
  ]);
});
