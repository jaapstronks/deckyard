/**
 * Notion API route handlers.
 *
 * This file orchestrates all Notion-related API endpoints by delegating
 * to modular handlers in the ./notion/ directory:
 * - notion/status.js - Status/capability detection
 * - notion/fetch.js - Fetch and publish endpoints
 * - notion/import.js - Import and stream-import endpoints
 * - notion/subjects.js - Subjects and compose endpoints (feature-gated)
 * - notion/suggest.js - Suggest endpoint (feature-gated)
 * - notion/utils.js - Shared utility functions
 */

import { dispatchRoutes } from '../../utils/router.js';
import { getFeatureFlags } from '../../config/flags-snapshot.js';
import {
  handleNotionStatus,
  handleNotionFetch,
  handleNotionPublish,
  handleNotionImport,
  handleNotionImportStream,
  handleNotionSubjects,
  handleNotionCompose,
  handleNotionSuggest,
} from './notion/index.js';

/**
 * Always-available Notion routes (A7.19 C8). Status is unconditional; the
 * fetch/publish/import handlers each self-gate on `notionEnabled()` (Notion is
 * *configured*) and 501 when it is not. Order mirrors the previous delegating
 * chain exactly; method mismatch falls through (the chain had no 405).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/notion/status', handler: handleNotionStatus },
  { method: 'POST', pattern: '/api/notion/fetch', handler: handleNotionFetch },
  { method: 'POST', pattern: '/api/notion/publish', handler: handleNotionPublish },
  { method: 'POST', pattern: '/api/notion/import', handler: handleNotionImport },
  { method: 'POST', pattern: '/api/notion/import/stream', handler: handleNotionImportStream },
];

/**
 * Feature-gated Notion routes: reached only when the `enableNotion` feature
 * flag is on. Kept in a second table so the flag check stays a single
 * module-wide guard in the entry function (route-dispatch.md § module-wide
 * guards belong in the entry function), exactly where the old chain returned
 * early before trying subjects/compose/suggest.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const GATED_ROUTES = [
  { method: 'POST', pattern: '/api/notion/subjects', handler: handleNotionSubjects },
  { method: 'POST', pattern: '/api/notion/compose', handler: handleNotionCompose },
  { method: 'POST', pattern: '/api/notion/suggest', handler: handleNotionSuggest },
];

/**
 * Handle Notion API requests.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>} true if a route handled the request.
 */
export async function handleNotion(ctx) {
  const handled = await dispatchRoutes(ROUTES, ctx);
  if (handled) return true;

  // Feature-gated endpoints: keep code shipped, but disabled unless explicitly enabled.
  const flags = getFeatureFlags();
  if (!flags?.enableNotion) return false;

  return dispatchRoutes(GATED_ROUTES, ctx);
}
