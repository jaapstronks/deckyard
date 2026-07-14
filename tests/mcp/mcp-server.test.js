/**
 * Tests for MCP Protocol Server
 * Run with: node --test tests/mcp/mcp-server.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  McpServer,
  jsonRpcResponse,
  jsonRpcError,
  ErrorCodes,
} from '../../server/mcp/protocol.js';

// ============================================================================
// Unit Tests: JSON-RPC Response Helpers
// ============================================================================

describe('JSON-RPC Helpers', () => {
  it('jsonRpcResponse creates valid response', () => {
    const resp = JSON.parse(jsonRpcResponse(1, { foo: 'bar' }));
    assert.strictEqual(resp.jsonrpc, '2.0');
    assert.strictEqual(resp.id, 1);
    assert.deepStrictEqual(resp.result, { foo: 'bar' });
    assert.strictEqual(resp.error, undefined);
  });

  it('jsonRpcError creates valid error response', () => {
    const resp = JSON.parse(jsonRpcError(1, -32600, 'Invalid Request'));
    assert.strictEqual(resp.jsonrpc, '2.0');
    assert.strictEqual(resp.id, 1);
    assert.strictEqual(resp.error.code, -32600);
    assert.strictEqual(resp.error.message, 'Invalid Request');
  });

  it('jsonRpcError includes data when provided', () => {
    const resp = JSON.parse(jsonRpcError(1, -32600, 'Error', { extra: 'info' }));
    assert.deepStrictEqual(resp.error.data, { extra: 'info' });
  });
});

// ============================================================================
// Unit Tests: McpServer Protocol
// ============================================================================

describe('McpServer', () => {
  describe('initialize', () => {
    it('returns correct protocol version', async () => {
      const server = new McpServer();
      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }));
      assert.strictEqual(resp.result.protocolVersion, '2024-11-05');
    });

    it('returns server info', async () => {
      const server = new McpServer({ name: 'test-server', version: '2.0.0' });
      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }));
      assert.strictEqual(resp.result.serverInfo.name, 'test-server');
      assert.strictEqual(resp.result.serverInfo.version, '2.0.0');
    });

    it('advertises tool capabilities', async () => {
      const server = new McpServer();
      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }));
      assert.ok(resp.result.capabilities.tools);
    });
  });

  describe('notifications', () => {
    it('notifications/initialized sets initialized flag', async () => {
      const server = new McpServer();
      assert.strictEqual(server.initialized, false);

      const result = await server.handleMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });

      assert.strictEqual(result, null); // No response for notifications
      assert.strictEqual(server.initialized, true);
    });

    it('notifications without id return null', async () => {
      const server = new McpServer();
      const result = await server.handleMessage({
        jsonrpc: '2.0',
        method: 'some/notification',
      });
      assert.strictEqual(result, null);
    });
  });

  describe('tools/list', () => {
    it('returns empty list when no tools registered', async () => {
      const server = new McpServer();
      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }));
      assert.deepStrictEqual(resp.result.tools, []);
    });

    it('returns registered tools', async () => {
      const server = new McpServer();
      server.tool('test_tool', 'A test tool', { type: 'object' }, async () => 'ok');
      server.tool('another_tool', 'Another tool', { type: 'object' }, async () => 'ok');

      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }));

      assert.strictEqual(resp.result.tools.length, 2);
      assert.strictEqual(resp.result.tools[0].name, 'test_tool');
      assert.strictEqual(resp.result.tools[0].description, 'A test tool');
      assert.strictEqual(resp.result.tools[1].name, 'another_tool');
    });

    it('includes input schemas in tool list', async () => {
      const server = new McpServer();
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      };
      server.tool('my_tool', 'My tool', schema, async () => 'ok');

      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }));

      assert.deepStrictEqual(resp.result.tools[0].inputSchema, schema);
    });
  });

  describe('tools/call', () => {
    it('executes tool handler', async () => {
      const server = new McpServer();
      server.tool('echo', 'Echo input', { type: 'object' }, async (params) => params);

      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: { msg: 'hello' } },
      }));

      assert.ok(resp.result.content);
      assert.strictEqual(resp.result.content[0].type, 'text');
      assert.ok(resp.result.content[0].text.includes('hello'));
    });

    it('returns string result as text content', async () => {
      const server = new McpServer();
      server.tool('greet', 'Say hello', { type: 'object' }, async () => 'Hello, World!');

      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'greet', arguments: {} },
      }));

      assert.strictEqual(resp.result.content[0].text, 'Hello, World!');
    });

    it('returns object result as JSON text', async () => {
      const server = new McpServer();
      server.tool('data', 'Return data', { type: 'object' }, async () => ({ key: 'value' }));

      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'data', arguments: {} },
      }));

      const content = JSON.parse(resp.result.content[0].text);
      assert.deepStrictEqual(content, { key: 'value' });
    });

    it('returns error for unknown tool', async () => {
      const server = new McpServer();
      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'nonexistent', arguments: {} },
      }));

      assert.ok(resp.error);
      assert.strictEqual(resp.error.code, ErrorCodes.METHOD_NOT_FOUND);
    });

    it('handles tool execution errors gracefully', async () => {
      const server = new McpServer();
      server.tool('broken', 'Will fail', { type: 'object' }, async () => {
        throw new Error('Something went wrong');
      });

      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'broken', arguments: {} },
      }));

      assert.ok(resp.result.isError);
      assert.ok(resp.result.content[0].text.includes('Something went wrong'));
    });

    it('works with empty arguments', async () => {
      const server = new McpServer();
      server.tool('noargs', 'No args needed', { type: 'object' }, async () => 'done');

      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'noargs' }, // No arguments key
      }));

      assert.strictEqual(resp.result.content[0].text, 'done');
    });
  });

  describe('ping', () => {
    it('responds to ping', async () => {
      const server = new McpServer();
      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
        params: {},
      }));

      assert.deepStrictEqual(resp.result, {});
    });
  });

  describe('error handling', () => {
    it('returns method not found for unknown method', async () => {
      const server = new McpServer();
      const resp = JSON.parse(await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'unknown/method',
        params: {},
      }));

      assert.ok(resp.error);
      assert.strictEqual(resp.error.code, ErrorCodes.METHOD_NOT_FOUND);
    });

    it('returns parse error for invalid message', async () => {
      const server = new McpServer();
      const resp = JSON.parse(await server.handleMessage(null));

      assert.ok(resp.error);
      assert.strictEqual(resp.error.code, ErrorCodes.PARSE_ERROR);
    });

    it('returns parse error for non-object message', async () => {
      const server = new McpServer();
      const resp = JSON.parse(await server.handleMessage('not an object'));

      assert.ok(resp.error);
      assert.strictEqual(resp.error.code, ErrorCodes.PARSE_ERROR);
    });
  });
});

// ============================================================================
// Integration Test: Tool Registration Pattern
// ============================================================================

describe('Tool Registration', () => {
  it('can register multiple tools', () => {
    const server = new McpServer();

    server.tool('tool1', 'First tool', { type: 'object' }, async () => '1');
    server.tool('tool2', 'Second tool', { type: 'object' }, async () => '2');
    server.tool('tool3', 'Third tool', { type: 'object' }, async () => '3');

    assert.strictEqual(server.tools.size, 3);
    assert.ok(server.tools.has('tool1'));
    assert.ok(server.tools.has('tool2'));
    assert.ok(server.tools.has('tool3'));
  });

  it('tool info is correctly stored', () => {
    const server = new McpServer();
    const handler = async () => 'result';
    const schema = { type: 'object', properties: { x: { type: 'number' } } };

    server.tool('my_tool', 'My description', schema, handler);

    const tool = server.tools.get('my_tool');
    assert.strictEqual(tool.name, 'my_tool');
    assert.strictEqual(tool.description, 'My description');
    assert.deepStrictEqual(tool.inputSchema, schema);
    assert.strictEqual(tool.handler, handler);
  });
});
