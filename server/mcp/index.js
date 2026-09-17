#!/usr/bin/env node

/**
 * Deckyard MCP Server
 *
 * Model Context Protocol server that exposes Deckyard's presentation
 * capabilities as tools for AI agents.
 *
 * Usage:
 *   node server/mcp/index.js              # stdio transport (default)
 *   node server/mcp/index.js --help       # show help
 *
 * Connect from Claude Desktop, Cursor, or any MCP-compatible client:
 *   {
 *     "mcpServers": {
 *       "deckyard": {
 *         "command": "node",
 *         "args": ["server/mcp/index.js"],
 *         "cwd": "/path/to/deckyard"
 *       }
 *     }
 *   }
 */

// stdout is protocol: this redirect must be installed before any other
// import can log (see ./stdout-guard.js). Keep it the first import.
import './stdout-guard.js';

import { McpServer, runStdio } from './protocol.js';
import { registerTools } from './tools.js';
import { loadCustomToolsRegistrar } from './custom-tools-loader.js';
import { registerPrompts } from './prompts.js';
import { helpText } from './help.js';
import { loadDotEnv } from '../config/env.js';
import { initializeStorage } from '../storage/lifecycle.js';
import { initSanitizer } from '../../shared/sanitize.js';
import { strandedFileDataError } from '../storage/boot-check.js';
import { storageModeError } from '../config/database.js';
import { repoRoot } from '../config/paths.js';
import { envStr } from '../config/utils.js';

/**
 * The MCP server with core tools, the fork's custom tools and the prompts
 * registered. `--help` and the stdio start build it the same way, so the help
 * lists what the running server serves.
 * @param {{ defaultOwnerEmail?: string|null }} [options]
 * @returns {Promise<McpServer>}
 */
async function buildServer({ defaultOwnerEmail = null } = {}) {
  const server = new McpServer({
    name: 'deckyard',
    version: '1.0.0',
  });
  const registerCustom = await loadCustomToolsRegistrar();
  registerTools(server, { defaultOwnerEmail, registerCustom });
  registerPrompts(server);
  return server;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write(helpText(await buildServer(), { repoRoot }));
  process.exit(0);
}

// Initialize
async function main() {
  // Load environment
  await loadDotEnv(repoRoot);

  // Same storage guards as the HTTP server (server/server.js): an unknown
  // STORAGE_MODE, or an empty database next to a populated file-storage data
  // directory, is a stop — an agent silently authoring into an empty organization
  // is worse than a failed handshake.
  {
    const modeErr = storageModeError();
    if (modeErr) {
      process.stderr.write(`[MCP] ${modeErr}\n`);
      process.exit(1);
    }
  }

  // Initialize storage (DB connection)
  try {
    await initializeStorage();
  } catch (err) {
    process.stderr.write(`[MCP] Storage init failed: ${err.message}\n`);
    process.stderr.write(
      '[MCP] Continuing with limited functionality (no DB-backed features)\n',
    );
  }

  {
    const strandedErr = await strandedFileDataError(repoRoot);
    if (strandedErr) {
      process.stderr.write(`[MCP] ${strandedErr}\n`);
      process.exit(1);
    }
  }

  // Enable sync HTML sanitization, exactly as the HTTP server does
  // (server/server.js). This process renders slide HTML too — preview tools,
  // exports — and every markdown field on that path goes through
  // sanitizeHtmlSync(). Without a DOMPurify instance that call falls back to
  // escaping, so the rendered slide shows its own markup as visible text.
  // Any Node entrypoint that can reach a render path owes this call; when one
  // forgets, shared/sanitize.js now warns once on the fallback instead of
  // degrading silently.
  await initSanitizer();

  // Default owner for presentations (can be set via env or CLI)
  const defaultOwnerEmail = envStr('DECKYARD_MCP_OWNER_EMAIL') || null;
  const server = await buildServer({ defaultOwnerEmail });

  // Log startup to stderr (stdout is for MCP protocol)
  process.stderr.write(
    '[MCP] Deckyard MCP server starting (stdio transport)\n',
  );
  if (defaultOwnerEmail) {
    process.stderr.write(`[MCP] Default owner: ${defaultOwnerEmail}\n`);
  }
  process.stderr.write(
    `[MCP] Registered ${server.tools.size} tools, ${server.prompts.size} prompts\n`,
  );

  // Run stdio transport
  runStdio(server);
}

main().catch((err) => {
  process.stderr.write(`[MCP] Fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
