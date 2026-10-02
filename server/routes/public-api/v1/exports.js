/**
 * Public API v1 - Export endpoints.
 * Handles presentation exports via API key authentication.
 */

import { buildStandaloneHtml } from '../../../export/html.js';
import { buildPrintHtml } from '../../../export/print.js';
import {
  buildEditablePptxBuffer,
  buildPptxBuffer,
  imageSlidesHeaders,
} from '../../../export/pptx.js';
import { presentationToDeck } from '../../../../shared/slide-types.js';
import { safeFilename } from '../../../utils/filename.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  checkExportLimit,
  trackExportRequest,
  apiError,
} from './middleware.js';
import { prepareExportContext } from '../../../services/exports.js';
import { isAppError } from '../../../utils/errors.js';
import { getRateLimitHeaders } from '../../../storage/api-usage.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * The export context for a v1 request: the key owner asks, `?lang=` names the
 * language, and a refusal is answered in the v1 envelope here.
 *
 * @param {Object} ctx - Request context
 * @param {string} presentationId
 * @param {{ format: string, allLanguages?: boolean }} options
 * @returns {Promise<import('../../../services/exports.js').ExportContext|null>}
 *   The context, or `null` when the refusal was already answered.
 */
async function exportContextFor(ctx, presentationId, { format, allLanguages }) {
  try {
    return await prepareExportContext(
      ctx.storageScope,
      { actor: ctx.authedUser },
      {
        presentationId,
        format,
        lang: ctx.url?.searchParams?.get('lang'),
        allLanguages,
      },
    );
  } catch (err) {
    if (!isAppError(err)) throw err;
    await apiError(ctx, err.statusCode, err.message, { code: err.code });
    return null;
  }
}

/**
 * Send export response with appropriate headers.
 */
async function sendExportResponse(
  ctx,
  { contentType, filename, extension, data, headers = {} },
) {
  const { res, apiKey } = ctx;

  const fullFilename = `${safeFilename(filename)}${extension}`;

  // Get rate limit headers
  const rateLimitHeaders = await getRateLimitHeaders(
    apiKey.id,
    apiKey.tier,
    'exports',
  );

  res.writeHead(200, {
    ...headers,
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fullFilename}"`,
    'Cache-Control': 'no-store',
    ...rateLimitHeaders,
  });
  res.end(data);
}

// ============================================================
// EXPORT HANDLERS
// ============================================================

/**
 * GET /api/v1/presentations/:id/export/json - Export as JSON.
 */
async function handleJsonExport(ctx, id) {
  if (!requirePermission(ctx, 'export')) return true;

  // Check export limit
  if (!(await checkExportLimit(ctx))) return true;

  const exportCtx = await exportContextFor(ctx, id, {
    format: 'json',
    allLanguages: true,
  });
  if (!exportCtx) return true;

  // Track export
  await trackExportRequest(ctx);

  // Build JSON export
  const deck = presentationToDeck(exportCtx.pres, {
    slideTypes: exportCtx.slideTypes,
  });
  const data = JSON.stringify(deck, null, 2);

  await sendExportResponse(ctx, {
    contentType: 'application/json; charset=utf-8',
    filename: `${exportCtx.title}${exportCtx.langSuffix}`,
    extension: '.json',
    data,
  });
  return true;
}

/**
 * GET /api/v1/presentations/:id/export/html - Export as standalone HTML.
 */
async function handleHtmlExport(ctx, id) {
  if (!requirePermission(ctx, 'export')) return true;

  if (!(await checkExportLimit(ctx))) return true;

  const { repoRoot } = ctx;
  const exportCtx = await exportContextFor(ctx, id, { format: 'html' });
  if (!exportCtx) return true;

  await trackExportRequest(ctx);

  try {
    const html = await buildStandaloneHtml(repoRoot, exportCtx.filteredPres, {
      theme: exportCtx.theme,
      slideTypes: exportCtx.slideTypes,
    });

    await sendExportResponse(ctx, {
      contentType: 'text/html; charset=utf-8',
      filename: `${exportCtx.title}${exportCtx.langSuffix}`,
      extension: '.html',
      data: html,
    });
    return true;
  } catch (e) {
    await apiError(ctx, 500, `Export failed: ${e.message}`);
    return true;
  }
}

/**
 * GET /api/v1/presentations/:id/export/pdf - Export as PDF.
 * Note: Returns HTML that can be printed to PDF client-side.
 */
async function handlePdfExport(ctx, id) {
  if (!requirePermission(ctx, 'export')) return true;

  if (!(await checkExportLimit(ctx))) return true;

  const { repoRoot } = ctx;
  const exportCtx = await exportContextFor(ctx, id, { format: 'pdf' });
  if (!exportCtx) return true;

  await trackExportRequest(ctx);

  try {
    const html = await buildPrintHtml(repoRoot, exportCtx.filteredPres, {
      theme: exportCtx.theme,
      slideTypes: exportCtx.slideTypes,
    });

    await sendExportResponse(ctx, {
      contentType: 'text/html; charset=utf-8',
      filename: `${exportCtx.title}${exportCtx.langSuffix}-print`,
      extension: '.html',
      data: html,
    });
    return true;
  } catch (e) {
    await apiError(ctx, 500, `Export failed: ${e.message}`);
    return true;
  }
}

/**
 * The two PowerPoint intents (D141), one handler each over the same body: the
 * pixel-perfect file (every slide an image, video plays; D307) and the
 * editable one (the theme's layouts, each slide as far as its type's
 * `fidelity.pptx` allows). The editable answer names its image slides in
 * {@link imageSlidesHeaders}; the file has no channel of its own for it.
 *
 * @param {{ format: string, extension: string, build: typeof buildPptxBuffer,
 *   reportImageSlides: boolean }} intent
 */
function pptxExportHandler({ format, extension, build, reportImageSlides }) {
  return async function handlePptxExport(ctx, id) {
    if (!requirePermission(ctx, 'export')) return true;

    if (!(await checkExportLimit(ctx))) return true;

    const { repoRoot, url } = ctx;
    const exportCtx = await exportContextFor(ctx, id, { format });
    if (!exportCtx) return true;

    await trackExportRequest(ctx);

    // Parse scale parameter
    const scaleParam = url.searchParams.get('scale');
    const scale = Math.max(1, Math.min(3, Number(scaleParam) || 2));

    try {
      const result = await build(repoRoot, exportCtx.filteredPres, {
        scale,
        theme: exportCtx.theme,
        slideTypes: exportCtx.slideTypes,
      });

      await sendExportResponse(ctx, {
        contentType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        filename: `${exportCtx.title}${exportCtx.langSuffix}`,
        extension,
        data: result.buffer,
        headers: reportImageSlides
          ? imageSlidesHeaders(result.imageSlides)
          : {},
      });
      return true;
    } catch (e) {
      await apiError(ctx, 500, `Export failed: ${e.message}`);
      return true;
    }
  };
}

/** GET /api/v1/presentations/:id/export/pptx - PowerPoint, pixel-perfect. */
const handlePptxExport = pptxExportHandler({
  format: 'pptx',
  extension: '.pptx',
  build: buildPptxBuffer,
  reportImageSlides: false,
});

/** GET /api/v1/presentations/:id/export/pptx-editable - PowerPoint, editable. */
const handleEditablePptxExport = pptxExportHandler({
  format: 'pptx-editable',
  extension: '-editable.pptx',
  build: buildEditablePptxBuffer,
  reportImageSlides: true,
});

// ============================================================
// MAIN HANDLER
// ============================================================

/** The five export formats, one row each; any other method answers 405. */
export const ROUTES = [
  {
    method: 'GET',
    id: 'exportPresentationJson',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/export\/json$/,
    captures: ['uuid'],
    handler: handleJsonExport,
  },
  {
    method: 'GET',
    id: 'exportPresentationHtml',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/export\/html$/,
    captures: ['uuid'],
    handler: handleHtmlExport,
  },
  {
    method: 'GET',
    id: 'exportPresentationPdf',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/export\/pdf$/,
    captures: ['uuid'],
    handler: handlePdfExport,
  },
  {
    method: 'GET',
    id: 'exportPresentationPptx',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/export\/pptx$/,
    captures: ['uuid'],
    handler: handlePptxExport,
  },
  {
    method: 'GET',
    id: 'exportPresentationPptxEditable',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/export\/pptx-editable$/,
    captures: ['uuid'],
    handler: handleEditablePptxExport,
  },
  {
    pattern:
      /^\/api\/v1\/presentations\/([^/]+)\/export\/(?:json|html|pdf|pptx|pptx-editable)$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
];

/**
 * Main handler for /api/v1/presentations/:id/export/* routes.
 */
export const handleExports = withV1ErrorHandler(
  'public-api-v1:exports',
  (ctx) => dispatchV1Routes(ROUTES, ctx),
);
