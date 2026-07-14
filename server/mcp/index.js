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

import { McpServer, runStdio } from './protocol.js';
import { registerTools } from './tools.js';
import { loadCustomToolsRegistrar } from './custom-tools-loader.js';
import { registerPrompts } from './prompts.js';
import { loadDotEnv } from '../config/env.js';
import { initializeStorage } from '../storage/adapters/index.js';
import { repoRoot } from '../config/paths.js';

// ─── CRITICAL: Redirect console.log to stderr ────────────────────────────
// MCP uses stdout exclusively for JSON-RPC protocol messages.
// Deckyard modules (storage, DB, etc.) use console.log for status messages.
// If those reach stdout, Claude Desktop sees invalid JSON and disconnects.
const _origLog = console.log;
console.log = (...args) => {
  process.stderr.write(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
};
console.info = console.log;
console.debug = console.log;
// console.warn and console.error already go to stderr

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write(`
Deckyard MCP Server — Expose presentation tools for AI agents

USAGE:
  node server/mcp/index.js          Start MCP server (stdio transport)

TOOLS:
  get_slide_types          List available slide types with schemas
  list_presentations       List all presentations (filtered by owner if configured)
  get_presentation         Get full presentation data
  create_presentation      Generate presentation from text using AI
  add_slide                Add slide to existing presentation
  update_slide             Update a slide's content
  remove_slide             Remove a slide by index
  reorder_slides           Move a slide between positions
  convert_slide            Convert slide to different type (AI)
  append_slides            Add AI-generated slides from new content
  iterate_presentation     Modify deck with natural language commands
  compress_presentation    Analyze/apply compression (merge, remove)
  analyze_presentation     Get AI improvement suggestions
  validate_presentation    Check slides for issues and suggestions
  duplicate_presentation   Create a copy of a presentation
  list_themes              List available themes
  delete_presentation      Delete (trash) a presentation
  get_presentation_url     Get edit and present URLs for a deck
  preview_slide            Render a single slide as inline HTML
  preview_presentation     Render all slides as inline HTML gallery

PROMPTS (appear in Claude Desktop "/" menu):
  create-presentation      Generate a deck from text/notes/document
  improve-presentation     Analyze and apply improvements to a deck
  refine-slide             Modify a specific slide with natural language
  compress-presentation    Make a deck shorter by merging/removing slides
  add-content              Add new slides from additional text
  deck-overview            Quick overview of a deck or list all decks

CONFIG:
  Reads .env from Deckyard root. Requires LLM vendor config for AI tools.
  Storage adapter (SQLite/Postgres) is auto-detected from environment.

  DECKYARD_MCP_OWNER_EMAIL  Set to filter presentations by owner and
                            assign ownership to new presentations.

CONNECT (Claude Desktop):
  Add to claude_desktop_config.json:
  {
    "mcpServers": {
      "deckyard": {
        "command": "node",
        "args": ["server/mcp/index.js"],
        "cwd": "${repoRoot}"
      }
    }
  }
`);
  process.exit(0);
}

// Initialize
async function main() {
  // Load environment
  await loadDotEnv(repoRoot);

  // Initialize storage (DB connection)
  try {
    await initializeStorage(repoRoot);
  } catch (err) {
    process.stderr.write(`[MCP] Storage init failed: ${err.message}\n`);
    process.stderr.write('[MCP] Continuing with limited functionality (no DB-backed features)\n');
  }

  // Create and configure server
  const server = new McpServer({
    name: 'deckyard',
    version: '1.0.0',
  });

  // Default owner for presentations (can be set via env or CLI)
  const defaultOwnerEmail = process.env.DECKYARD_MCP_OWNER_EMAIL || null;
  const registerCustom = await loadCustomToolsRegistrar();
  registerTools(server, { defaultOwnerEmail, registerCustom });
  registerPrompts(server);

  // Log startup to stderr (stdout is for MCP protocol)
  process.stderr.write('[MCP] Deckyard MCP server starting (stdio transport)\n');
  if (defaultOwnerEmail) {
    process.stderr.write(`[MCP] Default owner: ${defaultOwnerEmail}\n`);
  }
  process.stderr.write(`[MCP] Registered ${server.tools.size} tools, ${server.prompts.size} prompts\n`);

  // Run stdio transport
  runStdio(server);
}

main().catch((err) => {
  process.stderr.write(`[MCP] Fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
