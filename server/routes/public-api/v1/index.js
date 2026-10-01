/**
 * Public API v1 main router.
 * Handles all /api/v1/* routes with API key authentication.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { serveJson } from '../../../utils/http.js';
import {
  MaintenanceWriteError,
  assertWritable,
} from '../../../config/maintenance.js';
import {
  authenticateApiKey,
  checkRequestRateLimit,
  dispatchV1Routes,
  requirePermission,
  trackRequest,
  sendV1Error,
  v1MethodNotAllowed,
  v1NotFound,
  withV1ErrorHandler,
} from './middleware.js';

// Feature handlers
import { handlePresentations } from './presentations.js';
import { handleExports } from './exports.js';
import { handleAi } from './ai.js';
import { handleResources } from './resources.js';
import { handlePublishing } from './publishing.js';
import { handleSlideLibrary } from './slide-library.js';
import { handleSlides } from './slides.js';
import { handleTranslation } from './translate.js';
import { handleComments } from './comments.js';
import { dispatchMounts } from '../../../utils/router.js';
import { isFeatureEnabled } from '../../../config/flags-snapshot.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';

// Generated deck JSON Schema (single source: the slide-type field registry).
import {
  SLIDE_TYPES,
  canonicalSlideType,
  resolveSlideTypeName,
} from '../../../../shared/slide-types.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import {
  deckJsonSchema,
  slideTypeContentSchema,
} from '../../../../shared/slide-types/json-schema.js';

// ============================================================
// API INFO ENDPOINT
// ============================================================

/**
 * Handle GET /api/v1/ - API info/health check
 */
async function handleApiInfo(ctx) {
  const { req, res, url } = ctx;

  if (url.pathname !== '/api/v1/' && url.pathname !== '/api/v1') {
    return false;
  }

  if (req.method !== 'GET') {
    return v1MethodNotAllowed(res, ['GET']);
  }

  serveJson(res, 200, {
    name: 'Deckyard Public API',
    version: 'v1',
    documentation: '/api/v1/docs',
    endpoints: {
      presentations: '/api/v1/presentations',
      themes: '/api/v1/themes',
      slideTypes: '/api/v1/slide-types',
      ai: '/api/v1/ai',
    },
  });
  return true;
}

// ============================================================
// DOCUMENTATION ENDPOINTS
// ============================================================

/**
 * The spec as this installation answers it: every path whose `x-feature`
 * cluster is off is left out (D257), so the spec never lists a path that
 * answers 404 here. Comments of the rest are kept.
 *
 * @param {string} source - `docs/openapi.yaml` as read from disk
 * @returns {string}
 */
export function filterOpenApiSpec(source) {
  const doc = parseDocument(source);
  const paths = doc.get('paths');
  const off = (paths?.items || []).filter((pair) => {
    const feature = pair.value?.get?.('x-feature');
    return feature && !isFeatureEnabled(feature);
  });
  // Nothing off: the file as written, byte for byte.
  if (off.length === 0) return source;
  for (const pair of off) paths.delete(pair.key);
  return doc.toString();
}

/**
 * Serve the OpenAPI specification, filtered to this installation's clusters.
 */
async function handleOpenApiSpec(ctx) {
  const { req, res, url, repoRoot } = ctx;

  if (url.pathname !== '/api/v1/openapi.yaml') {
    return false;
  }

  if (req.method !== 'GET') {
    return v1MethodNotAllowed(res, ['GET']);
  }

  try {
    const specPath = path.join(repoRoot, 'docs', 'openapi.yaml');
    const spec = filterOpenApiSpec(await fs.readFile(specPath, 'utf8'));
    res.writeHead(200, {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(spec);
    return true;
  } catch {
    return v1NotFound(res, 'OpenAPI specification not found');
  }
}

/**
 * Serve the Swagger UI documentation page.
 */
async function handleDocs(ctx) {
  const { req, res, url } = ctx;

  if (url.pathname !== '/api/v1/docs' && url.pathname !== '/api/v1/docs/') {
    return false;
  }

  if (req.method !== 'GET') {
    return v1MethodNotAllowed(res, ['GET']);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deckyard API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin-bottom: 20px; }
    .swagger-ui .info .title { font-size: 2em; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/api/v1/openapi.yaml',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: 'BaseLayout',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 2,
        docExpansion: 'list',
        persistAuthorization: true,
      });
    };
  </script>
</body>
</html>`;

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(html);
  return true;
}

const SCHEMA_CACHE = { 'Cache-Control': 'public, max-age=3600' };
const ORG_SCHEMA_CACHE = { 'Cache-Control': 'private, max-age=3600' };

/** Anything else under `/api/v1/schema/`: GET is an unknown schema, the rest 405. */
function handleUnknownSchema({ req, res }) {
  if (req.method !== 'GET') return v1MethodNotAllowed(res, ['GET']);
  return v1NotFound(res, 'Unknown schema');
}

/**
 * Serve the generated JSON Schema for the deck format. Public (like the
 * OpenAPI spec): a published format contract should be fetchable without an
 * API key. Generated live from the slide-type registry, so it always matches
 * this install's actual types (including any custom ones) and can never drift
 * from the code.
 *   GET /api/v1/schema/deck.json                     - full deck schema
 *   GET /api/v1/schema/slide-types/:id.json          - one type's content schema
 */
export const SCHEMA_ROUTES = [
  {
    method: 'GET',
    id: 'getDeckSchema',
    pattern: '/api/v1/schema/deck.json',
    handler: function handleDeckSchema({ res }) {
      serveJson(res, 200, deckJsonSchema(SLIDE_TYPES), SCHEMA_CACHE);
      return true;
    },
  },
  {
    // A published type id, not a row id. One optional `<namespace>/` segment,
    // because a fork type without a dotted authority publishes in the slash
    // form (`custom/hero`, `acme/hero`) and that is its canonical id.
    method: 'GET',
    id: 'getSlideTypeSchema',
    pattern: /^\/api\/v1\/schema\/slide-types\/([^/]+|[^/]+\/[^/]+)\.json$/,
    captures: ['text'],
    handler: async function handleSlideTypeSchema(ctx, name) {
      const { req, res } = ctx;
      // A public request can describe only process-wide types. An API key
      // supplies the organization for its published database-backed types.
      const authenticated = Boolean(req.headers.authorization);
      if (authenticated) {
        if (!(await authenticateApiKey(ctx)).ok) return true;
        if (!requirePermission(ctx, 'read')) return true;
      }
      const slideTypes = authenticated
        ? await buildMergedSlideTypes(ctx.storageScope)
        : SLIDE_TYPES;
      // One spelling: the id the format publishes (`canonicalSlideType`).
      // A bare registry key or a qualified form names no schema here.
      const key = resolveSlideTypeName(name, slideTypes);
      if (!key || canonicalSlideType(key) !== name) {
        return v1NotFound(res, `Slide type '${name}' not found`);
      }
      serveJson(
        res,
        200,
        slideTypeContentSchema(name, slideTypes[key], {
          withMeta: true,
        }),
        authenticated ? ORG_SCHEMA_CACHE : SCHEMA_CACHE,
      );
      return true;
    },
  },
  { pattern: /^\/api\/v1\/schema\//, handler: handleUnknownSchema },
];

function handleSchema(ctx) {
  return dispatchV1Routes(SCHEMA_ROUTES, ctx);
}

// ============================================================
// MAIN ROUTER
// ============================================================

/**
 * The feature modules behind API-key authentication, in order. Each module
 * entry is wrapped in withV1ErrorHandler, so a throw from any sub-handler
 * answers the v1 envelope rather than leaking the internal `{ ok:false, … }`
 * shape. A mount with a `feature` is skipped while that installation cluster
 * is off (D257): `/ai/*` then answers the v1 404, the same answer the internal
 * `/api/ai/*` gives.
 *
 * @type {import('../../../utils/router.js').Mount[]}
 */
export const V1_MOUNTS = [
  { handle: handlePublishing },
  { handle: handleTranslation },
  { handle: handleSlideLibrary },
  { handle: handleSlides },
  { handle: handleComments },
  { handle: handlePresentations },
  { handle: handleExports },
  { handle: handleAi, feature: 'ai' },
  { handle: handleResources },
];

/**
 * Main handler for all /api/v1/* routes.
 * Authenticates API key and routes to feature handlers.
 *
 * Wrapped in withV1ErrorHandler itself, on top of the per-module wraps: a
 * throw from the pre-dispatch phase (auth, rate limiting, the meta endpoints)
 * must answer the v1 envelope too, not the internal one the outer /api
 * dispatcher would emit.
 * @param {Object} ctx - Request context { repoRoot, req, res, url }
 * @returns {Promise<boolean>} - True if handled
 */
export const handlePublicApiV1 = withV1ErrorHandler(
  'public-api-v1',
  async (ctx) => {
    const { url } = ctx;

    // Only handle /api/v1/ routes
    if (!url.pathname.startsWith('/api/v1')) {
      return false;
    }

    // Maintenance write gate. The v1 surface runs the shared choke-point itself
    // (like the MCP tool dispatch) so the refusal answers this surface's own
    // envelope, not the internal `{ ok:false, … }` one the /api dispatcher emits.
    try {
      assertWritable(ctx.req.method);
    } catch (err) {
      if (!(err instanceof MaintenanceWriteError)) throw err;
      return sendV1Error(
        ctx.res,
        503,
        'Deckyard is briefly unavailable for maintenance. Retry after the moment named in Retry-After.',
        {
          code: 'maintenance',
          details: err.state,
          headers: { 'Retry-After': String(err.retryAfter) },
        },
      );
    }

    // API info endpoint doesn't require auth
    if (url.pathname === '/api/v1/' || url.pathname === '/api/v1') {
      return handleApiInfo(ctx);
    }

    // Documentation endpoints don't require auth
    if (await handleDocs(ctx)) return true;
    if (await handleOpenApiSpec(ctx)) return true;
    if (await handleSchema(ctx)) return true;

    // Authenticate API key
    const authResult = await authenticateApiKey(ctx);
    if (!authResult.ok) {
      return true; // Response already sent
    }

    // Check per-minute rate limit
    if (!(await checkRequestRateLimit(ctx))) {
      return true; // Response already sent
    }

    // Track the request (don't await - fire and forget)
    fireAndForget(trackRequest(ctx), 'v1 request tracking');

    if (await dispatchMounts(V1_MOUNTS, ctx)) return true;

    return v1NotFound(ctx.res);
  },
);
