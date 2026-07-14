/**
 * Public API v1 main router.
 * Handles all /api/v1/* routes with API key authentication.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { notFound, methodNotAllowed, serveJson } from '../../../utils/http.js';
import { authenticateApiKey, checkRequestRateLimit, trackRequest } from './middleware.js';

// Feature handlers
import { handlePresentations } from './presentations.js';
import { handleExports } from './exports.js';
import { handleAi } from './ai.js';
import { handleResources } from './resources.js';
import { handlePublishing } from './publishing.js';
import { handleSlideLibrary } from './slide-library.js';
import { handleSlides } from './slides.js';
import { handleTranslation } from './translate.js';

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
    return methodNotAllowed(res, ['GET']);
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
 * Serve the OpenAPI specification.
 */
async function handleOpenApiSpec(ctx) {
  const { req, res, url, repoRoot } = ctx;

  if (url.pathname !== '/api/v1/openapi.yaml') {
    return false;
  }

  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    const specPath = path.join(repoRoot, 'docs', 'openapi.yaml');
    const spec = await fs.readFile(specPath, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(spec);
    return true;
  } catch {
    return notFound(res, 'OpenAPI specification not found');
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
    return methodNotAllowed(res, ['GET']);
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

// ============================================================
// MAIN ROUTER
// ============================================================

/**
 * Main handler for all /api/v1/* routes.
 * Authenticates API key and routes to feature handlers.
 * @param {Object} ctx - Request context { repoRoot, req, res, url }
 * @returns {Promise<boolean>} - True if handled
 */
export async function handlePublicApiV1(ctx) {
  const { req, res, url } = ctx;

  // Only handle /api/v1/ routes
  if (!url.pathname.startsWith('/api/v1')) {
    return false;
  }

  // API info endpoint doesn't require auth
  if (url.pathname === '/api/v1/' || url.pathname === '/api/v1') {
    return handleApiInfo(ctx);
  }

  // Documentation endpoints don't require auth
  if (await handleDocs(ctx)) return true;
  if (await handleOpenApiSpec(ctx)) return true;

  // Authenticate API key
  const authResult = await authenticateApiKey(ctx);
  if (!authResult.ok) {
    return true; // Response already sent
  }

  // Check per-minute rate limit
  if (!checkRequestRateLimit(ctx)) {
    return true; // Response already sent
  }

  // Track the request (don't await - fire and forget)
  trackRequest(ctx).catch(() => {});

  // Route to feature handlers
  if (await handlePublishing(ctx)) return true;
  if (await handleTranslation(ctx)) return true;
  if (await handleSlideLibrary(ctx)) return true;
  if (await handleSlides(ctx)) return true;
  if (await handlePresentations(ctx)) return true;
  if (await handleExports(ctx)) return true;
  if (await handleAi(ctx)) return true;
  if (await handleResources(ctx)) return true;

  return notFound(res);
}
