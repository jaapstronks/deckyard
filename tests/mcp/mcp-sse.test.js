/**
 * Tests for MCP SSE Transport — protocol-level tests only.
 * These test the context passing and McpServer changes without requiring DB.
 *
 * Run with: node --test tests/mcp/mcp-sse.test.js
 *
 * Integration tests (requiring DB + pg) should run on Jaap's machine:
 *   node --test tests/mcp/mcp-sse-integration.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Resolve the server/mcp directory relative to this test file so the structure
// checks work from any checkout (not a hardcoded sandbox path).
const MCP_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../server/mcp');

describe('MCP SSE Transport — Protocol', () => {

  describe('Context passing through McpServer', () => {
    it('handleMessage passes context to tool handlers', async () => {
      const { McpServer } = await import('../../server/mcp/protocol.js');
      const server = new McpServer();

      let receivedArgs = null;
      let receivedContext = null;
      server.tool('test_tool', 'Test', { type: 'object', properties: {} }, async (args, ctx) => {
        receivedArgs = args;
        receivedContext = ctx;
        return 'ok';
      });

      const context = { ownerEmail: 'test@example.com', transport: 'sse' };

      // Initialize
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      await server.handleMessage({ method: 'notifications/initialized' });

      // Call tool with context
      const response = await server.handleMessage(
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'test_tool', arguments: { foo: 'bar' } } },
        context
      );

      assert.deepEqual(receivedArgs, { foo: 'bar' });
      assert.deepEqual(receivedContext, context);

      const parsed = JSON.parse(response);
      assert.equal(parsed.id, 2);
      assert.ok(parsed.result);
      assert.equal(parsed.result.content[0].text, 'ok');
    });

    it('handleMessage works without context (stdio backward compat)', async () => {
      const { McpServer } = await import('../../server/mcp/protocol.js');
      const server = new McpServer();

      let receivedContext = undefined;
      server.tool('test_tool', 'Test', { type: 'object', properties: {} }, async (args, ctx) => {
        receivedContext = ctx;
        return 'ok';
      });

      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      await server.handleMessage({ method: 'notifications/initialized' });

      // Call without context — simulates stdio transport
      await server.handleMessage(
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'test_tool', arguments: {} } }
      );

      assert.equal(receivedContext, undefined);
    });

    it('context is not passed to non-tool methods', async () => {
      const { McpServer } = await import('../../server/mcp/protocol.js');
      const server = new McpServer();

      server.tool('test_tool', 'Test', { type: 'object', properties: {} }, async () => 'ok');

      const context = { ownerEmail: 'test@example.com' };

      // tools/list doesn't need context
      const response = await server.handleMessage(
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        context
      );
      const parsed = JSON.parse(response);
      assert.ok(parsed.result.tools);
      assert.equal(parsed.result.tools.length, 1);
    });

    it('context is passed per-call, not shared between calls', async () => {
      const { McpServer } = await import('../../server/mcp/protocol.js');
      const server = new McpServer();

      const contexts = [];
      server.tool('test_tool', 'Test', { type: 'object', properties: {} }, async (args, ctx) => {
        contexts.push(ctx);
        return 'ok';
      });

      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      await server.handleMessage({ method: 'notifications/initialized' });

      // Two calls with different contexts
      await server.handleMessage(
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'test_tool', arguments: {} } },
        { ownerEmail: 'alice@example.com' }
      );
      await server.handleMessage(
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'test_tool', arguments: {} } },
        { ownerEmail: 'bob@example.com' }
      );

      assert.equal(contexts.length, 2);
      assert.equal(contexts[0].ownerEmail, 'alice@example.com');
      assert.equal(contexts[1].ownerEmail, 'bob@example.com');
    });
  });

  describe('Protocol error handling with context', () => {
    it('unknown tool returns error even with context', async () => {
      const { McpServer } = await import('../../server/mcp/protocol.js');
      const server = new McpServer();

      const response = await server.handleMessage(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nonexistent', arguments: {} } },
        { ownerEmail: 'test@example.com' }
      );

      const parsed = JSON.parse(response);
      assert.ok(parsed.error);
      assert.equal(parsed.error.code, -32601);
    });

    it('tool error returns isError with context', async () => {
      const { McpServer } = await import('../../server/mcp/protocol.js');
      const server = new McpServer();

      server.tool('failing_tool', 'Fails', { type: 'object', properties: {} }, async () => {
        throw new Error('Deliberate test error');
      });

      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

      const response = await server.handleMessage(
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'failing_tool', arguments: {} } },
        { ownerEmail: 'test@example.com' }
      );

      const parsed = JSON.parse(response);
      assert.ok(parsed.result.isError);
      assert.ok(parsed.result.content[0].text.includes('Deliberate test error'));
    });
  });

  describe('SSE module structure', () => {
    // These verify the file exists and has the right shape,
    // without importing (which would trigger pg dependency)
    it('sse.js exists', async () => {
      const fs = await import('node:fs/promises');
      const stat = await fs.stat(path.join(MCP_DIR, 'sse.js'));
      assert.ok(stat.isFile());
    });

    it('sse-mount.js exists', async () => {
      const fs = await import('node:fs/promises');
      const stat = await fs.stat(path.join(MCP_DIR, 'sse-mount.js'));
      assert.ok(stat.isFile());
    });

    it('sse.js exports expected functions (source check)', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(path.join(MCP_DIR, 'sse.js'), 'utf8');
      assert.ok(content.includes('export function createSseHandler'));
      assert.ok(content.includes('export function getSseStatus'));
    });

    it('sse.js implements session management', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(path.join(MCP_DIR, 'sse.js'), 'utf8');
      assert.ok(content.includes('SESSION_TTL_MS'));
      assert.ok(content.includes('createSession'));
      assert.ok(content.includes('destroySession'));
      assert.ok(content.includes('getSession'));
    });

    it('sse.js implements CORS', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(path.join(MCP_DIR, 'sse.js'), 'utf8');
      assert.ok(content.includes('Access-Control-Allow-Origin'));
      assert.ok(content.includes('Access-Control-Allow-Headers'));
      assert.ok(content.includes('Mcp-Session-Id'));
    });

    it('sse.js uses existing validateApiKey', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(path.join(MCP_DIR, 'sse.js'), 'utf8');
      assert.ok(content.includes("import { validateApiKey }"));
      assert.ok(content.includes('Bearer'));
    });

    it('sse.js passes context with ownerEmail to handleMessage', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(path.join(MCP_DIR, 'sse.js'), 'utf8');
      assert.ok(content.includes('server.handleMessage(msg, context)'));
      assert.ok(content.includes('ownerEmail:'));
      assert.ok(content.includes("transport: 'sse'"));
    });
  });
});
