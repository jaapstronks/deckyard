/**
 * Tests for MCP Tool Definitions
 * Run with: node --test tests/mcp/mcp-tools.test.js
 *
 * These tests verify that tools are properly registered with valid schemas.
 * Full integration tests (actually calling tools) need DB access.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { McpServer } from '../../server/mcp/protocol.js';
import { registerTools } from '../../server/mcp/tools.js';

// ============================================================================
// Tool Registration Tests
// ============================================================================

describe('MCP Tools Registration', () => {
  it('all 22 tools are registered', async () => {
    const server = new McpServer();
    registerTools(server, { defaultOwnerEmail: 'test@test.com' });
    assert.strictEqual(server.tools.size, 22, `Expected 22 tools, got ${server.tools.size}`);
  });

  it('registers without defaultOwnerEmail', async () => {
    const server = new McpServer();
    registerTools(server, {});
    assert.strictEqual(server.tools.size, 22);
  });

  it('all tools have required fields', async () => {
    const server = new McpServer();
    registerTools(server, {});
    for (const [name, tool] of server.tools) {
      assert.ok(tool.description, `${name} missing description`);
      assert.ok(tool.inputSchema, `${name} missing inputSchema`);
      assert.ok(typeof tool.handler === 'function', `${name} missing handler`);
    }
  });

  it('tool names are valid MCP identifiers (lowercase with underscores)', async () => {
    const server = new McpServer();
    registerTools(server, {});
    for (const name of server.tools.keys()) {
      assert.ok(/^[a-z_]+$/.test(name), `Invalid tool name: ${name}`);
    }
  });

  it('all inputSchemas have type: object', async () => {
    const server = new McpServer();
    registerTools(server, {});
    for (const [name, tool] of server.tools) {
      assert.strictEqual(
        tool.inputSchema.type,
        'object',
        `${name} inputSchema.type should be 'object'`
      );
    }
  });

  it('all inputSchemas have properties object', async () => {
    const server = new McpServer();
    registerTools(server, {});
    for (const [name, tool] of server.tools) {
      assert.ok(
        typeof tool.inputSchema.properties === 'object',
        `${name} inputSchema.properties should be an object`
      );
    }
  });
});

// ============================================================================
// Expected Tool List
// ============================================================================

describe('MCP Tools Inventory', () => {
  const expectedTools = [
    'get_slide_types',
    'list_presentations',
    'get_presentation',
    'create_presentation',
    'create_presentation_from_slides',
    'update_slide',
    'add_slide',
    'convert_slide',
    'iterate_presentation',
    'validate_presentation',
    'list_themes',
    'delete_presentation',
    'remove_slide',
    'reorder_slides',
    'append_slides',
    'compress_presentation',
    'analyze_presentation',
    'duplicate_presentation',
    'get_presentation_url',
    'export_presentation',
    'preview_slide',
    'preview_presentation',
  ];

  it('has all expected tools', async () => {
    const server = new McpServer();
    registerTools(server, {});

    for (const toolName of expectedTools) {
      assert.ok(server.tools.has(toolName), `Missing tool: ${toolName}`);
    }
  });

  it('has no unexpected tools', async () => {
    const server = new McpServer();
    registerTools(server, {});

    for (const toolName of server.tools.keys()) {
      assert.ok(
        expectedTools.includes(toolName),
        `Unexpected tool: ${toolName} (update expectedTools array if intentional)`
      );
    }
  });
});

// ============================================================================
// Schema Validation for Key Tools
// ============================================================================

describe('MCP Tool Schemas', () => {
  it('create_presentation requires content', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('create_presentation');
    assert.ok(tool.inputSchema.required.includes('content'));
  });

  it('create_presentation accepts ownerEmail', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('create_presentation');
    assert.ok('ownerEmail' in tool.inputSchema.properties);
  });

  it('get_presentation requires id', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('get_presentation');
    assert.ok(tool.inputSchema.required.includes('id'));
  });

  it('update_slide requires presentationId, slideIndex, content', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('update_slide');
    const required = tool.inputSchema.required;
    assert.ok(required.includes('presentationId'));
    assert.ok(required.includes('slideIndex'));
    assert.ok(required.includes('content'));
  });

  it('iterate_presentation requires presentationId and command', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('iterate_presentation');
    const required = tool.inputSchema.required;
    assert.ok(required.includes('presentationId'));
    assert.ok(required.includes('command'));
  });

  it('export_presentation requires presentationId and format', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('export_presentation');
    const required = tool.inputSchema.required;
    assert.ok(required.includes('presentationId'));
    assert.ok(required.includes('format'));
  });

  it('export_presentation format enum lists the supported formats', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('export_presentation');
    const enumVals = tool.inputSchema.properties.format.enum;
    assert.deepStrictEqual(
      [...enumVals].sort(),
      ['html', 'json', 'pdf', 'png-zip', 'pptx']
    );
  });

  it('compress_presentation has apply and intensity options', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('compress_presentation');
    const props = tool.inputSchema.properties;
    assert.ok('apply' in props);
    assert.ok('intensity' in props);
    assert.deepStrictEqual(props.intensity.enum, ['moderate', 'aggressive']);
  });

  it('reorder_slides requires fromIndex and toIndex', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('reorder_slides');
    const required = tool.inputSchema.required;
    assert.ok(required.includes('presentationId'));
    assert.ok(required.includes('fromIndex'));
    assert.ok(required.includes('toIndex'));
  });

  it('preview_slide requires presentationId and slideIndex', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('preview_slide');
    const required = tool.inputSchema.required;
    assert.ok(required.includes('presentationId'));
    assert.ok(required.includes('slideIndex'));
  });

  it('preview_presentation has optional slideRange', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('preview_presentation');
    assert.ok('slideRange' in tool.inputSchema.properties);
    // slideRange is optional (not in required)
    assert.ok(!tool.inputSchema.required.includes('slideRange'));
  });

  it('get_slide_types has category filter with enum', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('get_slide_types');
    const props = tool.inputSchema.properties;
    assert.ok('category' in props);
    assert.deepStrictEqual(props.category.enum, ['structural', 'content', 'all']);
  });

  it('get_slide_types exposes lang param and returns example field', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('get_slide_types');
    assert.ok('lang' in tool.inputSchema.properties);
    assert.deepStrictEqual(tool.inputSchema.properties.lang.enum, ['nl', 'en-GB']);

    const { types, exampleLang } = await tool.handler({ lang: 'nl' });
    assert.strictEqual(exampleLang, 'nl');
    assert.ok(types['title-slide'], 'title-slide should be in catalog');
    assert.ok(types['title-slide'].example, 'title-slide should have an example');
    assert.strictEqual(typeof types['title-slide'].example.title, 'string');
  });

  it('create_presentation_from_slides requires title and slides', async () => {
    const server = new McpServer();
    registerTools(server, {});
    const tool = server.tools.get('create_presentation_from_slides');
    assert.ok(tool, 'tool must be registered');
    assert.ok(tool.inputSchema.required.includes('title'));
    assert.ok(tool.inputSchema.required.includes('slides'));
    assert.ok('validation' in tool.inputSchema.properties);
    assert.deepStrictEqual(tool.inputSchema.properties.validation.enum, ['strict', 'fix']);
    assert.ok('auto_prepend_title' in tool.inputSchema.properties);
  });
});

// ============================================================================
// Custom Tools Extension Seam (forks)
// ============================================================================

describe('MCP Tools custom seam', () => {
  it('invokes registerCustom after core tools, with the documented ctx', () => {
    const core = new McpServer();
    registerTools(core, {});
    const coreCount = core.tools.size;

    const server = new McpServer();
    let seenCtx = null;
    let countAtCallback = 0;
    registerTools(server, {
      defaultOwnerEmail: 'fork@test.com',
      registerCustom: (srv, ctx) => {
        seenCtx = ctx;
        countAtCallback = srv.tools.size;
        srv.tool(
          'fork_tool',
          'A fork-only tool',
          { type: 'object', properties: {} },
          async () => 'ok'
        );
      },
    });

    assert.strictEqual(countAtCallback, coreCount, 'core tools registered first');
    assert.strictEqual(server.tools.size, coreCount + 1);
    assert.ok(server.tools.has('fork_tool'));

    assert.ok(seenCtx, 'ctx passed to registerCustom');
    assert.strictEqual(typeof seenCtx.repoRoot, 'string');
    assert.strictEqual(seenCtx.defaultOwnerEmail, 'fork@test.com');
    assert.strictEqual(typeof seenCtx.getAppBaseUrl, 'function');
    assert.strictEqual(typeof seenCtx.presentationUrl, 'function');
    // getOwner prefers per-request (SSE) context over the static default
    assert.strictEqual(
      seenCtx.getOwner({ ownerEmail: 'session@test.com' }),
      'session@test.com'
    );
    assert.strictEqual(seenCtx.getOwner(), 'fork@test.com');
  });

  it('core tool count is unaffected when no registerCustom is passed', () => {
    const a = new McpServer();
    registerTools(a, {});
    const b = new McpServer();
    registerTools(b, { registerCustom: null });
    assert.strictEqual(a.tools.size, b.tools.size);
  });

  it('loadCustomToolsRegistrar returns a function or null without throwing', async () => {
    const { loadCustomToolsRegistrar } = await import(
      '../../server/mcp/custom-tools-loader.js'
    );
    const fn = await loadCustomToolsRegistrar();
    assert.ok(fn === null || typeof fn === 'function');
  });
});
