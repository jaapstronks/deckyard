/**
 * Maintenance write-gate parity — MCP ↔ /api ↔ /api/v1.
 *
 * The maintenance gate refuses writes so a deploy window cannot corrupt a
 * database that is mid-migration. That decision lives in ONE place
 * (`assertWritable` in server/config/maintenance.js) and every write surface
 * goes through it: the HTTP API dispatcher (which fronts both /api and
 * /api/v1) and the MCP tool dispatch. This file pins that parity:
 *
 * - every MCP tool is classified (readOnly or write) and the classification
 *   matches the pinned list — a new tool must consciously pick a side, and an
 *   unmarked tool fails closed as a write;
 * - with maintenance active, every write tool is refused BEFORE its handler
 *   runs, and read tools are never refused by the gate;
 * - the same flag produces the 503 on /api and /api/v1 writes.
 *
 * Run with: node --test tests/mcp/mcp-maintenance-gate.test.js
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  MaintenanceWriteError,
  assertWritable,
  resetMaintenanceForTests,
  setMaintenanceActive,
} from '../../server/config/maintenance.js';
import { McpServer } from '../../server/mcp/protocol.js';
import { registerTools } from '../../server/mcp/tools.js';
import { handleApi } from '../../server/routes/api/index.js';

/**
 * The read-only MCP tools — the only ones allowed through during maintenance.
 * Everything else in the registry is a write and must be refused. If you add
 * a tool, this list forces the classification to be a conscious decision:
 * mark it `{ readOnly: true }` and add it here, or leave it unmarked and it
 * is (correctly) blocked during maintenance.
 */
const READ_ONLY_TOOLS = [
  'get_slide_types',
  'list_presentations',
  'get_presentation',
  'validate_presentation',
  'list_themes',
  'analyze_presentation',
  'get_presentation_url',
  'export_presentation',
  'preview_slide',
  'preview_presentation',
  'list_comments',
  'list_recent_comments',
];

function buildServer() {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: 'test@example.com' });
  return server;
}

async function callTool(server, name, args = {}) {
  const raw = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  return JSON.parse(raw);
}

function isMaintenanceRefusal(resp) {
  return (
    resp.result?.isError === true &&
    /unavailable for maintenance/i.test(resp.result?.content?.[0]?.text || '')
  );
}

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    writeHead(code, headers) {
      this.statusCode = code;
      Object.assign(this.headers, headers || {});
    },
    end(chunk) {
      this.body = chunk;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

function apiCtx(method, pathname) {
  const res = mockRes();
  return {
    res,
    ctx: {
      repoRoot: '/tmp',
      req: { method, headers: {} },
      res,
      url: { pathname, searchParams: new URLSearchParams() },
    },
  };
}

afterEach(() => resetMaintenanceForTests());

describe('assertWritable — the shared choke-point', () => {
  it('lets everything pass while maintenance is off', () => {
    resetMaintenanceForTests();
    assert.doesNotThrow(() => assertWritable('POST'));
    assert.doesNotThrow(() => assertWritable());
  });

  it('refuses writes during maintenance, carrying the refusal payload', () => {
    setMaintenanceActive(true, { reason: 'shutdown' });
    let err;
    try {
      assertWritable('POST');
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof MaintenanceWriteError);
    assert.equal(err.status, 503);
    assert.equal(err.code, 'maintenance');
    assert.ok(err.retryAfter > 0, 'carries a retry hint');
    assert.equal(err.state.active, true);
    assert.equal(err.state.reason, 'shutdown');
  });

  it('a call without a method is a write by definition (MCP tools)', () => {
    setMaintenanceActive(true);
    assert.throws(() => assertWritable(), MaintenanceWriteError);
  });

  it('reads pass untouched even during maintenance', () => {
    setMaintenanceActive(true);
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      assert.doesNotThrow(() => assertWritable(m), `${m} must pass`);
    }
  });
});

describe('MCP tool classification', () => {
  it('matches the pinned read-only list exactly — new tools pick a side here', () => {
    const server = buildServer();
    const readOnly = [...server.tools.values()]
      .filter((t) => t.readOnly)
      .map((t) => t.name)
      .sort();
    assert.deepEqual(readOnly, [...READ_ONLY_TOOLS].sort());
    // Sanity: the registry is complete and the rest are writes.
    assert.equal(server.tools.size, 27);
  });

  it('tools/list advertises readOnlyHint for the read-only tools only', async () => {
    const server = buildServer();
    const resp = JSON.parse(
      await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    );
    for (const tool of resp.result.tools) {
      if (READ_ONLY_TOOLS.includes(tool.name)) {
        assert.deepEqual(
          tool.annotations,
          { readOnlyHint: true },
          `${tool.name} advertises readOnlyHint`,
        );
      } else {
        assert.equal(
          tool.annotations,
          undefined,
          `${tool.name} is a write, no readOnlyHint`,
        );
      }
    }
  });
});

describe('MCP write-gate behavior', () => {
  it('every write tool is refused during maintenance, before its handler runs', async () => {
    const server = buildServer();
    setMaintenanceActive(true, { reason: 'shutdown' });
    const writeTools = [...server.tools.values()]
      .filter((t) => !t.readOnly)
      .map((t) => t.name);
    assert.equal(writeTools.length, 15, 'the 15 mutating tools');
    for (const name of writeTools) {
      // Empty args: the refusal must come from the gate, not from argument
      // validation inside the handler — the maintenance text proves which.
      const resp = await callTool(server, name);
      assert.ok(
        isMaintenanceRefusal(resp),
        `${name} must be refused by the maintenance gate, got: ${JSON.stringify(resp)}`,
      );
    }
  });

  it('an unmarked (custom/fork) tool fails closed as a write', async () => {
    const server = buildServer();
    let ran = false;
    server.tool(
      'custom_mutator',
      'fork-registered tool without a readOnly flag',
      { type: 'object', properties: {} },
      async () => {
        ran = true;
        return { ok: true };
      },
    );
    setMaintenanceActive(true);
    const resp = await callTool(server, 'custom_mutator');
    assert.ok(isMaintenanceRefusal(resp), 'unmarked tool is refused');
    assert.equal(ran, false, 'the handler never ran');
  });

  it('read tools are never refused by the gate during maintenance', async () => {
    const server = buildServer();
    setMaintenanceActive(true);
    for (const name of READ_ONLY_TOOLS) {
      // The handler may still fail for other reasons in this bare test env
      // (no storage); the assertion is only that the maintenance gate did not
      // refuse it.
      const resp = await callTool(server, name);
      assert.ok(
        !isMaintenanceRefusal(resp),
        `${name} must pass the maintenance gate`,
      );
    }
  });

  it('the refusal lifts when maintenance ends', async () => {
    const server = buildServer();
    let ran = false;
    server.tool(
      'probe_write',
      'write probe',
      { type: 'object', properties: {} },
      async () => {
        ran = true;
        return { ok: true };
      },
    );
    setMaintenanceActive(true);
    assert.ok(isMaintenanceRefusal(await callTool(server, 'probe_write')));
    setMaintenanceActive(false);
    const resp = await callTool(server, 'probe_write');
    assert.equal(resp.result.isError, undefined);
    assert.equal(ran, true, 'handler runs again after maintenance');
  });
});

describe('HTTP parity — /api and /api/v1 sit behind the same gate', () => {
  it('a write on /api answers 503 maintenance with Retry-After', async () => {
    setMaintenanceActive(true, { reason: 'shutdown' });
    const { ctx, res } = apiCtx('POST', '/api/presentations');
    await handleApi(ctx);
    assert.equal(res.statusCode, 503);
    assert.ok(res.headers['Retry-After'], 'carries Retry-After');
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'maintenance');
    assert.equal(body.details?.active, true, 'echoes the maintenance state');
  });

  it('a write on /api/v1 answers 503 maintenance — v1 dispatches behind the gate', async () => {
    setMaintenanceActive(true);
    const { ctx, res } = apiCtx('POST', '/api/v1/presentations');
    await handleApi(ctx);
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'maintenance');
  });

  it('a read on /api still answers during maintenance', async () => {
    setMaintenanceActive(true);
    const { ctx, res } = apiCtx('GET', '/api/maintenance');
    await handleApi(ctx);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).active, true);
  });
});
