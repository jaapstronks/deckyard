/**
 * Sandbox-only API surface.
 *
 * GET /api/sandbox/examples — the demo decks a guest can open and edit. Returns
 * 404 outside sandbox mode so the endpoint simply doesn't exist on a normal
 * install. Instantiating an example reuses /api/presentations/import/json, so
 * there is no create endpoint here.
 */

import { serveJson, notFound } from '../../utils/http.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { listSandboxExamples } from '../../sandbox/examples.js';

export async function handleSandbox({ repoRoot, req, res, url }) {
  if (url.pathname === '/api/sandbox/examples' && req.method === 'GET') {
    if (!sandboxEnabled()) return notFound(res);
    const examples = await listSandboxExamples(repoRoot);
    serveJson(res, 200, { examples });
    return true;
  }
  return false;
}
