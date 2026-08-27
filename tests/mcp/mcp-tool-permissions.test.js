/**
 * MCP permission + quota gate — parity with /api/v1.
 *
 * `/api/v1` and `/mcp` authenticate with the same `dk_live_*` API keys, so one
 * key must mean one thing on both transports. v1 calls `requirePermission`
 * before every handler and spends per-minute/daily limits; MCP does the same
 * at `tools/call` (server/mcp/authorization.js). This file pins that:
 *
 * - every registered tool declares a required permission that matches the
 *   pinned table — a new tool must consciously pick one, and a tool that
 *   declares none is refused for a keyed caller (fail closed), the same shape
 *   as the maintenance write-gate;
 * - a key without that permission is refused with v1's wording, before the
 *   handler runs, and `tools/list` does not advertise what it may not call;
 * - a keyless (stdio) call is not gated — there is no key to judge;
 * - AI and export calls consult the same daily limits as v1, every keyed call
 *   lands in the same `api_usage_daily` counters, and — as on v1 — a refused
 *   call still costs the bucket and the request counter, so an out-of-scope
 *   call is not a cheap way to keep the server busy.
 *
 * Run with: node --test tests/mcp/mcp-tool-permissions.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = ['amethyst', 'test', 'permissions']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const { createFakeDb } = await import('../helpers/fake-db.js');
const { __setTestDb } = await import('../../server/db/client.js');
const { initializeStorage } = await import('../../server/storage/lifecycle.js');
const { McpServer } = await import('../../server/mcp/protocol.js');
const { registerTools } = await import('../../server/mcp/tools.js');
const { enforceToolPolicy } = await import('../../server/mcp/authorization.js');
const { AVAILABLE_PERMISSIONS, TIER_LIMITS } =
  await import('../../server/storage/api-keys.js');
const { resetRateLimitBuckets } =
  await import('../../server/utils/rate-limit.js');

const KEY_ID = 'key-under-test';

/**
 * The permission every MCP tool requires, mirroring its `/api/v1` counterpart:
 * reads are `read`, deck/slide mutations are `write`, anything that calls an
 * LLM is `ai` (v1 charges AI generation to `ai`, not `ai` plus `write`),
 * downloads are `export`, comments are `comments:read`/`comments:write`.
 *
 * Adding a tool without adding it here fails this file — deliberately.
 */
const TOOL_PERMISSIONS = {
  get_slide_types: 'read',
  list_presentations: 'read',
  get_presentation: 'read',
  create_presentation: 'ai',
  create_presentation_from_slides: 'write',
  update_slide: 'write',
  add_slide: 'write',
  convert_slide: 'ai',
  iterate_presentation: 'ai',
  validate_presentation: 'read',
  list_themes: 'read',
  delete_presentation: 'write',
  remove_slide: 'write',
  reorder_slides: 'write',
  append_slides: 'ai',
  compress_presentation: 'ai',
  analyze_presentation: 'ai',
  duplicate_presentation: 'write',
  get_presentation_url: 'read',
  export_presentation: 'export',
  preview_slide: 'read',
  preview_presentation: 'read',
  list_comments: 'comments:read',
  list_recent_comments: 'comments:read',
  add_comment: 'comments:write',
  reply_to_comment: 'comments:write',
  set_comment_status: 'comments:write',
};

/**
 * Install a seeded database double and point the storage facade at Postgres.
 * @param {Array<Object>} [usageRows] - Seed rows for `api_usage_daily`
 * @returns {Promise<Object>} The database double
 */
async function installDb(usageRows = []) {
  const db = createFakeDb({ api_usage_daily: usageRows });
  __setTestDb(db);
  await initializeStorage();
  return db;
}

/**
 * Today's date the way the usage storage layer writes it.
 * @returns {string} YYYY-MM-DD
 */
function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * A per-request context carrying an acting API key.
 * @param {string[]} permissions - The key's granted permissions
 * @param {Object} [overrides] - Extra key fields (e.g. `tier`)
 * @returns {Object} Tool context
 */
function keyedContext(permissions, overrides = {}) {
  return {
    ownerEmail: 'owner@example.com',
    apiKey: { id: KEY_ID, tier: 'free', permissions, ...overrides },
    transport: 'sse',
  };
}

/**
 * Call one tool and return the parsed JSON-RPC result.
 * @param {McpServer} server - Server under test
 * @param {string} name - Tool name
 * @param {Object} [context] - Per-request context (omit for stdio)
 * @returns {Promise<Object>} The `result` object
 */
async function callTool(server, name, context) {
  const raw = await server.handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } },
    context,
  );
  return JSON.parse(raw).result;
}

/**
 * A single-tool server whose handler records that it ran.
 * @param {Object} [options] - `permission` for the tool (omit to leave it
 *   undeclared)
 * @returns {{server: McpServer, ran: () => boolean}}
 */
function serverWithTool(options = {}) {
  const server = new McpServer();
  let ran = false;
  server.tool(
    'probe',
    'Probe',
    { type: 'object', properties: {} },
    async () => {
      ran = true;
      return 'ok';
    },
    { readOnly: true, ...options },
  );
  return { server, ran: () => ran };
}

beforeEach(() => {
  resetRateLimitBuckets();
});

describe('MCP tool registry — every tool declares a permission', () => {
  it('declares a known permission for every registered tool', async () => {
    const server = new McpServer();
    registerTools(server, { defaultOwnerEmail: 'owner@example.com' });

    for (const [name, tool] of server.tools) {
      assert.ok(tool.permission, `${name} declares no required permission`);
      assert.ok(
        AVAILABLE_PERMISSIONS.includes(tool.permission),
        `${name} declares unknown permission ${tool.permission}`,
      );
    }
  });

  it('matches the pinned permission table exactly', async () => {
    const server = new McpServer();
    registerTools(server, { defaultOwnerEmail: 'owner@example.com' });

    const actual = Object.fromEntries(
      [...server.tools].map(([name, tool]) => [name, tool.permission]),
    );
    assert.deepEqual(actual, TOOL_PERMISSIONS);
  });

  it('refuses a permission-less tool for a keyed caller, before its handler runs', async () => {
    const { server, ran } = serverWithTool();
    const result = await callTool(
      server,
      'probe',
      keyedContext(AVAILABLE_PERMISSIONS),
    );

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /declares no required permission/);
    assert.equal(ran(), false, 'handler must not run');
  });

  it('does not gate a keyless (stdio) call', async () => {
    const { server, ran } = serverWithTool();
    const result = await callTool(server, 'probe');

    assert.equal(result.isError, undefined);
    assert.equal(ran(), true);
  });
});

describe('MCP permission gate — a key may do exactly what it may do on v1', () => {
  for (const permission of AVAILABLE_PERMISSIONS) {
    it(`refuses a ${permission} tool for a key without it`, async () => {
      await installDb();
      const { server, ran } = serverWithTool({ permission });
      const others = AVAILABLE_PERMISSIONS.filter((p) => p !== permission);

      const result = await callTool(server, 'probe', keyedContext(others));

      assert.equal(result.isError, true);
      assert.equal(
        result.content[0].text,
        `Error: API key lacks required permission: ${permission}`,
      );
      assert.equal(ran(), false, 'handler must not run');
    });

    it(`allows a ${permission} tool for a key that has it`, async () => {
      await installDb();
      const { server, ran } = serverWithTool({ permission });

      const result = await callTool(
        server,
        'probe',
        keyedContext([permission]),
      );

      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      assert.equal(ran(), true);
    });
  }

  it('hides tools the key lacks the permission for from tools/list', async () => {
    const server = new McpServer();
    registerTools(server, { defaultOwnerEmail: 'owner@example.com' });

    const raw = await server.handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      keyedContext(['read']),
    );
    const listed = JSON.parse(raw).result.tools.map((t) => t.name);

    const expected = Object.entries(TOOL_PERMISSIONS)
      .filter(([, permission]) => permission === 'read')
      .map(([name]) => name);
    assert.deepEqual(listed.sort(), expected.sort());
    assert.ok(!listed.includes('delete_presentation'));
  });

  it('lists every tool for a keyless (stdio) caller', async () => {
    const server = new McpServer();
    registerTools(server, { defaultOwnerEmail: 'owner@example.com' });

    const raw = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    assert.equal(
      JSON.parse(raw).result.tools.length,
      Object.keys(TOOL_PERMISSIONS).length,
    );
  });
});

describe('MCP quota gate — one counter across both transports', () => {
  it('refuses an AI tool once the daily AI limit is spent', async () => {
    await installDb([
      {
        api_key_id: KEY_ID,
        date: today(),
        request_count: 0,
        ai_request_count: TIER_LIMITS.free.aiCallsPerDay,
        export_count: 0,
      },
    ]);
    const { server, ran } = serverWithTool({ permission: 'ai' });

    const result = await callTool(server, 'probe', keyedContext(['ai']));

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Daily AI request limit exceeded/);
    assert.equal(ran(), false);
  });

  it('refuses an export tool once the daily export limit is spent', async () => {
    await installDb([
      {
        api_key_id: KEY_ID,
        date: today(),
        request_count: 0,
        ai_request_count: 0,
        export_count: TIER_LIMITS.free.exportsPerDay,
      },
    ]);
    const { server, ran } = serverWithTool({ permission: 'export' });

    const result = await callTool(server, 'probe', keyedContext(['export']));

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Daily export limit exceeded/);
    assert.equal(ran(), false);
  });

  it('spends the same per-minute bucket a v1 request would', async () => {
    await installDb();
    const { server } = serverWithTool({ permission: 'read' });
    const context = keyedContext(['read']);

    for (let i = 0; i < TIER_LIMITS.free.requestsPerMinute; i += 1) {
      const ok = await callTool(server, 'probe', context);
      assert.equal(ok.isError, undefined, `call ${i} should be allowed`);
    }

    const limited = await callTool(server, 'probe', context);
    assert.equal(limited.isError, true);
    assert.match(limited.content[0].text, /Rate limit exceeded/);
  });

  it('counts an AI tool call in the same api_usage_daily counters as v1', async () => {
    const db = await installDb();

    const policy = await enforceToolPolicy(
      { name: 'probe', permission: 'ai' },
      keyedContext(['ai']),
    );
    await policy.tracked;

    assert.equal(policy.ok, true);
    const rows = db.__tables.api_usage_daily;
    assert.equal(rows.length, 1, 'both writes land on today\u2019s row');
    assert.equal(rows[0].api_key_id, KEY_ID);
    assert.equal(rows[0].date, today());
    assert.equal(rows[0].request_count, 1);
    assert.equal(rows[0].ai_request_count, 1);
    assert.equal(rows[0].export_count, 0);
  });

  it('charges a refused call the request it cost, exactly as v1 does', async () => {
    const db = await installDb();

    const policy = await enforceToolPolicy(
      { name: 'probe', permission: 'write' },
      keyedContext(['read']),
    );
    await policy.tracked;

    assert.equal(policy.ok, false);
    const rows = db.__tables.api_usage_daily;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].request_count, 1);
    assert.equal(rows[0].ai_request_count, 0);
  });

  it('does not count a keyless (stdio) call', async () => {
    const db = await installDb();

    const policy = await enforceToolPolicy(
      { name: 'probe', permission: 'ai' },
      { transport: 'stdio' },
    );

    assert.equal(policy.ok, true);
    assert.equal(policy.tracked, null);
    assert.equal(db.__tables.api_usage_daily.length, 0);
  });
});
