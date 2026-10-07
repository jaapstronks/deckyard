/**
 * Sandbox-only API surface.
 *
 * GET /api/sandbox/examples — the demo decks a guest can open and edit.
 * POST /api/sandbox/examples/:id — open one: import the server's copy of the
 * example as the guest's own deck (the same import as
 * /api/presentations/import/json) and write the viewing history the example
 * declares, so `/insights` has something to show (B353).
 *
 * Both answer 404 outside sandbox mode, so the surface simply doesn't exist
 * on a normal install.
 */

import { serveJson, notFound, withErrorHandler } from '../../utils/http.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { dispatchRoutes } from '../../utils/router.js';
import {
  getSandboxExample,
  listSandboxExamples,
} from '../../sandbox/examples.js';
import { seedSandboxAnalytics } from '../../sandbox/analytics.js';
import { importJsonDeck } from '../../services/import-json.js';

// GET /api/sandbox/examples - The demo decks a guest can open and edit
async function handleSandboxExamples({ repoRoot, res }) {
  if (!sandboxEnabled()) return notFound(res);
  const examples = await listSandboxExamples(repoRoot);
  // The viewing profile is the server's business; the shelf needs the deck.
  serveJson(res, 200, {
    examples: examples.map(({ analytics: _profile, ...example }) => example),
  });
  return true;
}

// POST /api/sandbox/examples/:id - Open an example as the guest's own deck
async function handleSandboxExampleOpen(
  { repoRoot, storageScope, res, authedUser },
  id,
) {
  if (!sandboxEnabled()) return notFound(res);
  const example = await getSandboxExample(repoRoot, id);
  if (!example) return notFound(res, 'Example not found');

  const result = await importJsonDeck({
    repoRoot,
    storageScope,
    actor: authedUser,
    deck: example.deck,
  });
  // A committed example that does not import is a server fault, not the
  // guest's: let the error wrapper answer 500.
  if (!result.ok) throw new Error(`Sandbox example ${id}: ${result.message}`);

  await seedSandboxAnalytics(
    storageScope,
    result.presentation,
    example.analytics,
  );
  serveJson(res, 201, result.presentation);
  return true;
}

/**
 * Declarative route table for `/api/sandbox/*` (A7.19 C8). Method-bearing
 * rows that fall through on any other method (Form A).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/sandbox/examples',
    handler: handleSandboxExamples,
  },
  {
    method: 'POST',
    pattern: /^\/api\/sandbox\/examples\/([a-z0-9-]+)$/,
    captures: ['text'],
    handler: handleSandboxExampleOpen,
  },
];

/**
 * Handle sandbox API routes.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleSandbox = withErrorHandler('sandbox', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
