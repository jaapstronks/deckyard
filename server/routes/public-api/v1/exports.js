/**
 * Public API v1 - Export endpoints.
 * Handles presentation exports via API key authentication.
 */

import { buildStandaloneHtml } from '../../../export/html.js';
import { buildPrintHtml } from '../../../export/print.js';
import { buildPptxBuffer } from '../../../export/pptx.js';
import { presentationToDeck } from '../../../../shared/slide-types.js';
import { safeFilename } from '../../../utils/filename.js';
import { stripLiveOnlySlidesFromPresentation } from '../../../utils/public-output.js';
import {
  normalizeLang,
  projectPresentationForLang,
} from '../../../utils/i18n.js';
import { loadThemeAssets } from '../../../utils/themes.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  checkExportLimit,
  trackExportRequest,
  apiError,
} from './middleware.js';
import { loadPresentationForActor } from '../../../services/presentations.js';
import { isAppError } from '../../../utils/errors.js';
import { getRateLimitHeaders } from '../../../storage/api-usage.js';
import { countInstanceHealth } from '../../../storage/instance-health.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get language suffix for filenames.
 */
function getLangSuffix(exportLang) {
  return exportLang === 'nl' ? '-NL' : exportLang === 'en-GB' ? '-EN' : '';
}

/**
 * Prepare export context with presentation loading and language projection.
 * A context that passes the access check counts one export of `format` on
 * the instance-health `export` axis, as the app's pipeline does (D247).
 */
async function prepareExportContext(
  ctx,
  presentationId,
  { format, allLanguages = false },
) {
  const { repoRoot, storageScope, url, apiKey } = ctx;
  // The JSON deck carries every language version (D89), so it skips the
  // `?lang=` projection that would drop the others.
  const exportLang = allLanguages
    ? null
    : normalizeLang(url?.searchParams?.get('lang'));

  let pres;
  try {
    pres = await loadPresentationForActor(
      storageScope,
      { actor: ctx.authedUser },
      presentationId,
    );
  } catch (err) {
    if (!isAppError(err)) throw err;
    return { ok: false, status: err.statusCode, error: err.message };
  }
  countInstanceHealth([{ axis: 'export', key: format }]);

  const projected = exportLang
    ? projectPresentationForLang(pres, exportLang)
    : pres;
  const filteredPres = stripLiveOnlySlidesFromPresentation(projected);
  const theme = await loadThemeAssets(repoRoot, projected?.theme, storageScope);
  const langSuffix = getLangSuffix(exportLang);

  // Load merged slide types (core + org-specific custom types)
  const orgId = apiKey?.organizationId || pres?.organizationId;
  const slideTypes = await buildMergedSlideTypes({ organizationId: orgId });

  return {
    ok: true,
    pres: projected,
    filteredPres,
    theme,
    slideTypes,
    exportLang,
    langSuffix,
    title: projected.title || 'presentation',
  };
}

/**
 * Send export response with appropriate headers.
 */
async function sendExportResponse(
  ctx,
  { contentType, filename, extension, data },
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

  const exportCtx = await prepareExportContext(ctx, id, {
    format: 'json',
    allLanguages: true,
  });
  if (!exportCtx.ok) {
    await apiError(ctx, exportCtx.status, exportCtx.error);
    return true;
  }

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
  const exportCtx = await prepareExportContext(ctx, id, { format: 'html' });
  if (!exportCtx.ok) {
    await apiError(ctx, exportCtx.status, exportCtx.error);
    return true;
  }

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
  const exportCtx = await prepareExportContext(ctx, id, { format: 'pdf' });
  if (!exportCtx.ok) {
    await apiError(ctx, exportCtx.status, exportCtx.error);
    return true;
  }

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
 * GET /api/v1/presentations/:id/export/pptx - Export as PowerPoint.
 */
async function handlePptxExport(ctx, id) {
  if (!requirePermission(ctx, 'export')) return true;

  if (!(await checkExportLimit(ctx))) return true;

  const { repoRoot, url } = ctx;
  const exportCtx = await prepareExportContext(ctx, id, { format: 'pptx' });
  if (!exportCtx.ok) {
    await apiError(ctx, exportCtx.status, exportCtx.error);
    return true;
  }

  await trackExportRequest(ctx);

  // Parse scale parameter
  const scaleParam = url.searchParams.get('scale');
  const scale = Math.max(1, Math.min(3, Number(scaleParam) || 2));

  try {
    const result = await buildPptxBuffer(repoRoot, exportCtx.filteredPres, {
      scale,
      theme: exportCtx.theme,
      slideTypes: exportCtx.slideTypes,
    });

    await sendExportResponse(ctx, {
      contentType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      filename: `${exportCtx.title}${exportCtx.langSuffix}`,
      extension: '.pptx',
      data: result.buffer,
    });
    return true;
  } catch (e) {
    await apiError(ctx, 500, `Export failed: ${e.message}`);
    return true;
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================

/** The four export formats, one row each; any other method answers 405. */
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
    pattern:
      /^\/api\/v1\/presentations\/([^/]+)\/export\/(?:json|html|pdf|pptx)$/,
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
