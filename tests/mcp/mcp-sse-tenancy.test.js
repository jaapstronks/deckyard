/**
 * MCP-over-SSE acts in the organization its API key belongs to.
 *
 * The SSE session is authenticated by a `dk_live_*` key, and that key belongs
 * to exactly one organization. The per-request context therefore carries an
 * `organizationId`, so `storageScopeOf()` in server/mcp/tools.js scopes storage
 * to it instead of falling through to `singleOrganizationScope()` — the branch
 * meant for a keyless stdio process bound to the whole instance.
 *
 * Regression guard: the context used to carry only `ownerEmail`, so every SSE
 * call took the stdio branch. On a multi-organization instance that branch
 * refuses to guess and throws, which made MCP-over-SSE unusable there; on a
 * single-organization one it silently used the default organization rather than
 * the key's. Both are pinned here, with `MULTI_ORG_ENABLED` on and the key
 * belonging to an organization that is *not* the instance default — so a scope
 * that follows the default instead of the key fails the assertions.
 *
 * Run with: node --test tests/mcp/mcp-sse-tenancy.test.js
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { userRows } from '../helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['amethyst', 'test', 'sse', 'tenancy']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.MULTI_ORG_ENABLED = 'true';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

/** The instance default organization — deliberately *not* the key's. */
const OTHER_ORG = process.env.DEFAULT_ORGANIZATION_ID;
/** The organization the API key under test belongs to. */
const KEY_ORG = '00000000-0000-0000-0000-0000000000bb';

const OWNER = 'owner@example.com';
const RAW_KEY = 'dk_live_sse-tenancy-key-00000000000000';

const { createFakeDb } = await import('../helpers/fake-db.js');
const { __setTestDb } = await import('../../server/db/client.js');
const { initializeStorage } = await import('../../server/storage/lifecycle.js');
const { hashToken } = await import('../../server/utils/secure-tokens.js');
const { McpServer } = await import('../../server/mcp/protocol.js');
const { registerTools } = await import('../../server/mcp/tools.js');
const { createSseHandler } = await import('../../server/mcp/sse.js');
const { createPresentation } =
  await import('../../server/storage/presentations/index.js');
const { resetRateLimitBuckets } =
  await import('../../server/utils/rate-limit.js');

/** @type {Function} The mounted `/mcp` handler under test. */
let handler;
/** @type {string} A deck the key's organization owns. */
let ownDeckId;
/** @type {string} A deck of the same owner, in the other organization. */
let foreignDeckId;

/**
 * A request the SSE handler can read a JSON body off.
 * @param {Object} body - JSON-RPC message to send
 * @param {Object} [headers] - Extra request headers (e.g. `mcp-session-id`)
 * @returns {import('node:http').IncomingMessage} Request double
 */
function jsonRequest(body, headers = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = 'POST';
  req.headers = {
    authorization: `Bearer ${RAW_KEY}`,
    'content-type': 'application/json',
    ...headers,
  };
  return req;
}

/**
 * A response double that records the status, headers and body written to it.
 * @returns {Object} Response double with `status`, `headers` and `body`
 */
function recordingResponse() {
  return {
    status: null,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk) {
      if (chunk) this.body += chunk;
    },
  };
}

/**
 * POST one JSON-RPC message to `/mcp` through the real handler.
 * @param {Object} body - JSON-RPC message
 * @param {Object} [headers] - Extra request headers
 * @returns {Promise<Object>} `{status, headers, json}` of the response
 */
async function post(body, headers) {
  const res = recordingResponse();
  const handled = await handler({
    req: jsonRequest(body, headers),
    res,
    url: new URL('http://localhost:4177/mcp'),
  });
  assert.equal(handled, true, 'handler must claim the /mcp request');
  return {
    status: res.status,
    headers: res.headers,
    json: res.body ? JSON.parse(res.body) : null,
  };
}

/**
 * Call a tool over SSE and return its text payload.
 * @param {string} name - Tool name
 * @param {Object} [args] - Tool arguments
 * @param {string|null} [sessionId] - Session to call in (null = stateless)
 * @returns {Promise<{isError: boolean, text: string}>} The tool result
 */
async function callTool(name, args = {}, sessionId = null) {
  const { json } = await post(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    sessionId ? { 'mcp-session-id': sessionId } : {},
  );
  assert.ok(
    json.result,
    `tools/call returned no result: ${JSON.stringify(json)}`,
  );
  return {
    isError: Boolean(json.result.isError),
    text: json.result.content?.[0]?.text ?? '',
  };
}

/**
 * Open a session the way a client does, and return its id.
 * @returns {Promise<string>} The `Mcp-Session-Id` handed out
 */
async function openSession() {
  const { headers } = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  });
  const sessionId = headers['Mcp-Session-Id'];
  assert.ok(sessionId, 'initialize must hand out a session id');
  return sessionId;
}

before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [
        { id: OTHER_ORG, name: 'Default', slug: 'default' },
        { id: KEY_ORG, name: 'Key org', slug: 'key-org' },
      ],
      users: userRows(OWNER),
      api_keys: [
        {
          id: 'key-sse-tenancy',
          organization_id: KEY_ORG,
          owner_email: OWNER,
          name: 'SSE tenancy key',
          key_prefix: RAW_KEY.slice(0, 12),
          key_hash: hashToken(RAW_KEY),
          tier: 'free',
          permissions: ['read', 'write'],
          revoked_at: null,
          last_used_at: null,
          created_at: '2026-08-01T00:00:00.000Z',
        },
      ],
    }),
  );
  await initializeStorage();

  // The same owner holds a deck in each organization, so organization scope is
  // the only thing that can keep them apart.
  ownDeckId = (
    await createPresentation(
      { repoRoot: null, organizationId: KEY_ORG },
      { title: 'Deck in the key organization', ownerEmail: OWNER },
    )
  ).id;
  foreignDeckId = (
    await createPresentation(
      { repoRoot: null, organizationId: OTHER_ORG },
      { title: 'Deck in another organization', ownerEmail: OWNER },
    )
  ).id;

  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: null });
  handler = createSseHandler(server, { basePath: '/mcp' });
});

beforeEach(() => {
  resetRateLimitBuckets();
});

describe('MCP over SSE — organization scope', () => {
  it('scopes a session call to the organization of its API key', async () => {
    const sessionId = await openSession();
    const { isError, text } = await callTool(
      'list_presentations',
      {},
      sessionId,
    );

    assert.equal(isError, false, `list_presentations failed: ${text}`);
    const ids = JSON.parse(text).presentations.map((p) => p.id);
    assert.deepEqual(ids, [ownDeckId]);
  });

  it('scopes a sessionless call to the organization of its API key', async () => {
    const { isError, text } = await callTool('list_presentations');

    assert.equal(isError, false, `list_presentations failed: ${text}`);
    const ids = JSON.parse(text).presentations.map((p) => p.id);
    assert.deepEqual(ids, [ownDeckId]);
  });

  it('keeps a deck in another organization out of reach', async () => {
    const sessionId = await openSession();
    const { isError, text } = await callTool(
      'get_presentation',
      { id: foreignDeckId },
      sessionId,
    );

    assert.equal(isError, true, 'a foreign deck must not be readable');
    // The refusal has to be the per-deck one — "not found" from a scope that
    // works — not the scope layer throwing because it had no organization.
    assert.match(text, /Presentation not found/i);
  });
});
