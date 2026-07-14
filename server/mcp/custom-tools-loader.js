/**
 * Custom MCP Tools Loader
 *
 * Discovers a fork-supplied `custom/mcp-tools.js` and returns its registrar,
 * so downstream forks add MCP tools without editing `server/mcp/tools.js`
 * (the same philosophy as `shared/slide-types/custom-loader.js`).
 *
 * The file is gitignored in the OSS repo and tracked in forks. Expected shape:
 *
 *   // custom/mcp-tools.js
 *   export default function registerCustomTools(server, ctx) {
 *     server.tool('my_tool', 'Description', { type: 'object', properties: {} },
 *       async (args, context) => { ... });
 *   }
 *
 * `ctx` is the helper surface documented on `registerTools` in ./tools.js:
 * `{ repoRoot, defaultOwnerEmail, getOwner, getAppBaseUrl, presentationUrl }`.
 * Anything else a custom tool needs can be imported directly — it runs in the
 * same process as core.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../config/paths.js';

const CUSTOM_TOOLS_FILE = join(repoRoot, 'custom', 'mcp-tools.js');

/**
 * Load the fork's custom-tools registrar, if any.
 * @returns {Promise<function|null>} a `(server, ctx) => void` registrar for
 *   `registerTools`'s `registerCustom` option, or null when absent/invalid.
 */
export async function loadCustomToolsRegistrar() {
  if (!existsSync(CUSTOM_TOOLS_FILE)) return null;
  try {
    const mod = await import(pathToFileURL(CUSTOM_TOOLS_FILE).href);
    const fn = mod.default ?? mod.registerCustomTools;
    if (typeof fn !== 'function') {
      console.warn(
        '[mcp] custom/mcp-tools.js exists but exports no function (default or registerCustomTools) — ignored'
      );
      return null;
    }
    console.log('[mcp] loaded custom tools registrar from custom/mcp-tools.js');
    return fn;
  } catch (err) {
    console.warn(`[mcp] failed to load custom/mcp-tools.js: ${err.message}`);
    return null;
  }
}
