/**
 * Lazy-init mount for MCP SSE transport.
 *
 * The MCP server (tools, prompts) is only initialized on first request
 * to /mcp, so it doesn't slow down normal Deckyard startup.
 */

import { McpServer } from './protocol.js';
import { registerTools } from './tools.js';
import { loadCustomToolsRegistrar } from './custom-tools-loader.js';
import { registerPrompts } from './prompts.js';
import { createSseHandler } from './sse.js';

// Memoized as a promise so concurrent first requests share one initialization.
let _handlerPromise = null;

function getHandler() {
  if (_handlerPromise) return _handlerPromise;

  _handlerPromise = (async () => {
    const server = new McpServer({
      name: 'deckyard',
      version: '1.0.0',
    });

    // MCP SSE: owner filtering is handled per-session via the API key's ownerEmail.
    // No global defaultOwnerEmail — each authenticated request gets its own scope.
    const registerCustom = await loadCustomToolsRegistrar();
    registerTools(server, { defaultOwnerEmail: null, registerCustom });
    registerPrompts(server);

    const handler = createSseHandler(server, { basePath: '/mcp' });

    const toolCount = server.tools.size;
    const promptCount = server.prompts.size;
    console.log(`[MCP/SSE] Initialized: ${toolCount} tools, ${promptCount} prompts`);

    return handler;
  })();

  return _handlerPromise;
}

/**
 * Handle MCP SSE requests. Safe to call on every request to /mcp.
 * Lazy-initializes the MCP server on first call.
 */
export async function handleMcpSse(ctx) {
  const handler = await getHandler();
  return handler(ctx);
}

/**
 * Re-export for the server.js import.
 */
export function initMcpSse() {
  // No-op on import — initialization is lazy.
  // This function exists so server.js can import the module at startup
  // without triggering initialization.
}
