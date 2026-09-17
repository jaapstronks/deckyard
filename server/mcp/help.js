/**
 * `--help` text for the MCP server, built from the registered server.
 *
 * The TOOLS and PROMPTS sections are read from `server.tools` and
 * `server.prompts`, so the help names exactly what a client sees on
 * `tools/list` and `prompts/list`. A hand-typed copy drifted (20 of 27 tools,
 * 6 of 7 prompts); there is no second list to keep in step.
 */

/**
 * The first sentence of a description, as the one-line summary for help.
 * @param {string} description
 * @returns {string}
 */
export function summaryOf(description) {
  const text = String(description || '')
    .replace(/\s+/g, ' ')
    .trim();
  const end = text.search(/[.!?](?=\s+[A-Z]|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}

/**
 * Two-column rows: name padded to the widest name, then its summary.
 * @param {Iterable<{ name: string, description: string }>} entries
 * @returns {string}
 */
function rows(entries) {
  const list = [...entries];
  const width = Math.max(0, ...list.map((e) => e.name.length)) + 2;
  return list
    .map((e) => `  ${e.name.padEnd(width)}${summaryOf(e.description)}`)
    .join('\n');
}

/**
 * The full `--help` text for a server with its tools and prompts registered.
 * @param {import('./protocol.js').McpServer} server
 * @param {{ repoRoot: string }} options
 * @returns {string}
 */
export function helpText(server, { repoRoot }) {
  return `
Deckyard MCP Server — Expose presentation tools for AI agents

USAGE:
  node server/mcp/index.js          Start MCP server (stdio transport)

TOOLS (${server.tools.size}):
${rows(server.tools.values())}

PROMPTS (${server.prompts.size}, appear in Claude Desktop "/" menu):
${rows(server.prompts.values())}

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
`;
}
