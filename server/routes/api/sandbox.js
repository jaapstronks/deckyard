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
import { dispatchRoutes } from '../../utils/router.js';
import { listSandboxExamples } from '../../sandbox/examples.js';

// GET /api/sandbox/examples - The demo decks a guest can open and edit
async function handleSandboxExamples({ repoRoot, res }) {
  if (!sandboxEnabled()) return notFound(res);
  const examples = await listSandboxExamples(repoRoot);
  serveJson(res, 200, { examples });
  return true;
}

/**
 * Declarative route table for `/api/sandbox/*` (A7.19 C8): one GET-only row
 * that falls through on any other method (Form A), exactly as the original
 * single-branch chain did.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/sandbox/examples', handler: handleSandboxExamples },
];

/**
 * Handle sandbox API routes.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleSandbox(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
