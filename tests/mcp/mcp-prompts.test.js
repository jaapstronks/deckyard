/**
 * Tests for MCP Prompt Templates
 * Run with: node --test tests/mcp/mcp-prompts.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { McpServer } from '../../server/mcp/protocol.js';
import { registerPrompts } from '../../server/mcp/prompts.js';

// ============================================================================
// Prompt Registration Tests
// ============================================================================

describe('MCP Prompts Registration', () => {
  it('registers all 7 prompts', () => {
    const server = new McpServer();
    registerPrompts(server);
    assert.strictEqual(server.prompts.size, 7, `Expected 7 prompts, got ${server.prompts.size}`);
  });

  it('all prompts have required fields', () => {
    const server = new McpServer();
    registerPrompts(server);
    for (const [name, prompt] of server.prompts) {
      assert.ok(prompt.description, `${name} missing description`);
      assert.ok(Array.isArray(prompt.arguments), `${name} arguments should be an array`);
      assert.ok(typeof prompt.handler === 'function', `${name} missing handler`);
    }
  });

  it('all prompt arguments have name and description', () => {
    const server = new McpServer();
    registerPrompts(server);
    for (const [promptName, prompt] of server.prompts) {
      for (const arg of prompt.arguments) {
        assert.ok(arg.name, `${promptName}: argument missing name`);
        assert.ok(arg.description, `${promptName}.${arg.name}: missing description`);
      }
    }
  });
});

// ============================================================================
// Expected Prompt List
// ============================================================================

describe('MCP Prompts Inventory', () => {
  const expectedPrompts = [
    'create-presentation',
    'create-from-structured-data',
    'improve-presentation',
    'refine-slide',
    'compress-presentation',
    'add-content',
    'deck-overview',
  ];

  it('has all expected prompts', () => {
    const server = new McpServer();
    registerPrompts(server);
    for (const name of expectedPrompts) {
      assert.ok(server.prompts.has(name), `Missing prompt: ${name}`);
    }
  });

  it('has no unexpected prompts', () => {
    const server = new McpServer();
    registerPrompts(server);
    for (const name of server.prompts.keys()) {
      assert.ok(
        expectedPrompts.includes(name),
        `Unexpected prompt: ${name} (update expectedPrompts if intentional)`
      );
    }
  });
});

// ============================================================================
// Prompt Handler Tests
// ============================================================================

describe('MCP Prompt Handlers', () => {
  it('create-presentation returns messages with content', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const prompt = server.prompts.get('create-presentation');
    const result = await prompt.handler({ content: 'Test content about Q1 results' });

    assert.ok(result.messages, 'Should return messages');
    assert.strictEqual(result.messages.length, 1);
    assert.strictEqual(result.messages[0].role, 'user');
    assert.ok(result.messages[0].content.text.includes('Test content about Q1 results'));
  });

  it('create-presentation includes language when specified', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const prompt = server.prompts.get('create-presentation');
    const result = await prompt.handler({ content: 'Test', language: 'nl' });

    assert.ok(result.messages[0].content.text.includes('"nl"'));
  });

  it('create-presentation includes speaker when specified', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const prompt = server.prompts.get('create-presentation');
    const result = await prompt.handler({ content: 'Test', speaker: 'Jaap Stronks' });

    assert.ok(result.messages[0].content.text.includes('Jaap Stronks'));
  });

  it('improve-presentation uses focus when provided', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const prompt = server.prompts.get('improve-presentation');
    const result = await prompt.handler({ presentationId: 'abc123', focus: 'punchier' });

    assert.ok(result.messages[0].content.text.includes('punchier'));
    assert.ok(result.messages[0].content.text.includes('abc123'));
  });

  it('deck-overview without ID lists all presentations', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const prompt = server.prompts.get('deck-overview');
    const result = await prompt.handler({});

    assert.ok(result.messages[0].content.text.includes('list_presentations'));
  });

  it('deck-overview with ID gets specific presentation', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const prompt = server.prompts.get('deck-overview');
    const result = await prompt.handler({ presentationId: 'xyz789' });

    assert.ok(result.messages[0].content.text.includes('xyz789'));
    assert.ok(result.messages[0].content.text.includes('validation'));
  });

  it('compress-presentation defaults to moderate', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const prompt = server.prompts.get('compress-presentation');
    const result = await prompt.handler({ presentationId: 'abc' });

    assert.ok(result.messages[0].content.text.includes('moderate'));
  });

  it('compress-presentation accepts aggressive', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const prompt = server.prompts.get('compress-presentation');
    const result = await prompt.handler({ presentationId: 'abc', intensity: 'aggressive' });

    assert.ok(result.messages[0].content.text.includes('aggressive'));
  });
});

// ============================================================================
// Protocol Integration Tests
// ============================================================================

describe('MCP Protocol — Prompts', () => {
  it('capabilities include prompts when registered', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const resp = JSON.parse(await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }));

    assert.ok(resp.result.capabilities.prompts, 'Should advertise prompts capability');
  });

  it('capabilities omit prompts when none registered', async () => {
    const server = new McpServer();
    const resp = JSON.parse(await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }));

    assert.strictEqual(resp.result.capabilities.prompts, undefined);
  });

  it('prompts/list returns all prompts', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const resp = JSON.parse(await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'prompts/list',
      params: {},
    }));

    assert.strictEqual(resp.result.prompts.length, 7);
    assert.ok(resp.result.prompts[0].name);
    assert.ok(resp.result.prompts[0].description);
    assert.ok(Array.isArray(resp.result.prompts[0].arguments));
  });

  it('prompts/get returns messages for valid prompt', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const resp = JSON.parse(await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'prompts/get',
      params: {
        name: 'create-presentation',
        arguments: { content: 'Hello world' },
      },
    }));

    assert.ok(resp.result.messages);
    assert.strictEqual(resp.result.messages[0].role, 'user');
    assert.ok(resp.result.messages[0].content.text.includes('Hello world'));
  });

  it('prompts/get returns error for unknown prompt', async () => {
    const server = new McpServer();
    registerPrompts(server);
    const resp = JSON.parse(await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'prompts/get',
      params: { name: 'nonexistent' },
    }));

    assert.ok(resp.error);
    assert.strictEqual(resp.error.code, -32601);
  });
});
