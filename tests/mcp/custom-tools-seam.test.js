/**
 * The custom-tools seam — a fork's registrar must not strip the gate.
 *
 * `server/mcp/custom-tools-loader.js` lets a fork enrich a core tool by
 * registering the same name again with the original handler in the closure.
 * `McpServer.tool()` fails closed on `readOnly`/`permission`, which is right
 * for a *first* registration and wrong for that re-register: the defaults
 * would silently drop the gate, and dropping it fails closed in the invisible
 * direction — `isToolVisible()` hides a tool without a permission from every
 * keyed caller and `enforceToolPolicy()` refuses it, while stdio (no key)
 * notices nothing. That is exactly how the fork ended up serving an empty
 * `tools/list` over HTTP while the server logged 29 tools at boot.
 *
 * `tests/mcp/mcp-tool-permissions.test.js` pins the core registry and cannot
 * see this: the strip happens in the layer that runs *after* `registerTools()`.
 * So this file pins the seam itself — the gate belongs to the tool name, not
 * to whoever registered it last:
 *
 * - a registrar that re-registers every core tool without restating options
 *   leaves every permission and every `readOnly` intact, and the enriched
 *   tools stay visible and callable for a keyed caller;
 * - restating an option is an explicit choice and wins — except removing a
 *   permission, which throws rather than producing a tool no key can reach;
 * - a genuinely new custom tool still fails closed when it declares nothing.
 *
 * Run with: node --test tests/mcp/custom-tools-seam.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '../../server/mcp/protocol.js';
import { registerTools } from '../../server/mcp/tools.js';
import {
  isToolVisible,
  enforceToolPolicy,
} from '../../server/mcp/authorization.js';

const OWNER = 'owner@example.com';
const SCHEMA = { type: 'object', properties: {} };

/**
 * The core registry, with no custom registrar in play.
 * @returns {Map<string, Object>} name → registered tool
 */
function coreTools() {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  return server.tools;
}

/**
 * A server whose core tools have all been re-registered by a fork registrar
 * that only wraps the handler — the shape `custom/mcp-tools.js` uses to
 * enrich core behaviour.
 * @param {Object} [options] - Options the registrar restates on re-register
 * @returns {McpServer} The server under test
 */
function serverWithEnrichingRegistrar(options = undefined) {
  const server = new McpServer();
  registerTools(server, {
    defaultOwnerEmail: OWNER,
    registerCustom: (srv) => {
      for (const entry of [...srv.tools.values()]) {
        srv.tool(
          entry.name,
          entry.description,
          entry.inputSchema,
          async (params, context) => {
            const result = await entry.handler(params, context);
            return { ...result, enriched: true };
          },
          options,
        );
      }
    },
  });
  return server;
}

/**
 * A per-request context carrying an acting API key.
 * @param {string[]} permissions - The key's granted permissions
 * @returns {Object} Tool context
 */
function keyedContext(permissions) {
  return {
    ownerEmail: OWNER,
    apiKey: { id: 'key-under-test', tier: 'free', permissions },
    transport: 'sse',
  };
}

describe('custom-tools seam — enriching a core tool keeps its gate', () => {
  it('keeps every permission when the registrar restates no options', () => {
    const before = coreTools();
    const after = serverWithEnrichingRegistrar().tools;

    assert.equal(after.size, before.size);
    for (const [name, entry] of before) {
      assert.equal(
        after.get(name).permission,
        entry.permission,
        `${name} lost its permission on re-register`,
      );
    }
  });

  it('keeps every readOnly flag when the registrar restates no options', () => {
    const before = coreTools();
    const after = serverWithEnrichingRegistrar().tools;

    for (const [name, entry] of before) {
      assert.equal(
        after.get(name).readOnly,
        entry.readOnly,
        `${name} lost its readOnly flag on re-register`,
      );
    }
  });

  it('leaves no tool ungated after the registrar has run', () => {
    for (const [name, entry] of serverWithEnrichingRegistrar().tools) {
      assert.ok(entry.permission, `${name} declares no required permission`);
    }
  });

  it('still advertises the enriched tools to a keyed caller', async () => {
    const server = serverWithEnrichingRegistrar();
    const context = keyedContext(['read']);

    const raw = await server.handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      context,
    );
    const names = JSON.parse(raw).result.tools.map((tool) => tool.name);

    assert.ok(names.includes('list_themes'));
    assert.ok(isToolVisible(server.tools.get('list_themes'), context));
  });

  it('still lets a keyed caller through the policy gate', async () => {
    const server = serverWithEnrichingRegistrar();

    const verdict = await enforceToolPolicy(
      server.tools.get('list_themes'),
      keyedContext(['read']),
    );

    assert.equal(verdict.ok, true, verdict.message);
    await verdict.tracked;
  });

  it('runs the fork wrapper around the core handler', async () => {
    const server = serverWithEnrichingRegistrar();

    const result = await server.tools.get('list_themes').handler({}, {});

    assert.equal(result.enriched, true);
    assert.ok(Array.isArray(result.themes));
  });
});

describe('custom-tools seam — restating an option is explicit', () => {
  it('honours a restated readOnly without touching the permission', () => {
    const before = coreTools();
    const after = serverWithEnrichingRegistrar({ readOnly: true }).tools;

    for (const [name, entry] of before) {
      assert.equal(after.get(name).readOnly, true);
      assert.equal(after.get(name).permission, entry.permission, name);
    }
  });

  it('honours a re-register that names a different permission', () => {
    const server = new McpServer();
    server.tool('probe', 'Probe', SCHEMA, async () => 'ok', {
      permission: 'read',
    });

    server.tool('probe', 'Probe', SCHEMA, async () => 'wrapped', {
      permission: 'write',
    });

    assert.equal(server.tools.get('probe').permission, 'write');
  });

  it('refuses a re-register that drops the permission', () => {
    const server = new McpServer();
    server.tool('probe', 'Probe', SCHEMA, async () => 'ok', {
      permission: 'read',
      readOnly: true,
    });

    assert.throws(
      () =>
        server.tool('probe', 'Probe', SCHEMA, async () => 'wrapped', {
          permission: null,
        }),
      /cannot drop it/,
    );
    assert.equal(server.tools.get('probe').permission, 'read');
  });
});

describe('custom-tools seam — a new tool still fails closed', () => {
  it('leaves a brand-new custom tool ungated when it declares nothing', () => {
    const server = new McpServer();
    registerTools(server, {
      defaultOwnerEmail: OWNER,
      registerCustom: (srv) => {
        srv.tool('publish_presentation', 'Publish', SCHEMA, async () => 'ok');
      },
    });

    const entry = server.tools.get('publish_presentation');
    assert.equal(entry.permission, null);
    assert.equal(entry.readOnly, false);
    assert.equal(isToolVisible(entry, keyedContext(['read'])), false);
  });
});
