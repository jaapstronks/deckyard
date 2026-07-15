/**
 * Public API v1 - Export endpoints.
 * Handles presentation exports via API key authentication.
 */

import { getPresentation } from '../../../storage/presentations.js';
import { buildStandaloneHtml } from '../../../export/html.js';
import { buildPrintHtml } from '../../../export/print.js';
import { buildPptxBuffer } from '../../../export/pptx.js';
import { presentationToDeck } from '../../../../shared/slide-types.js';
import { methodNotAllowed } from '../../../utils/http.js';
import { safeFilename } from '../../../utils/filename.js';
import { stripLiveOnlySlidesFromPresentation } from '../../../utils/public-output.js';
import { normalizeLang, projectPresentationForLang } from '../../../utils/i18n.js';
import { loadTheme } from '../../../utils/themes.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import { getDefaultOrganizationId } from '../../../config/database.js';
import {
  requireScope,
  checkExportLimit,
  trackExportRequest,
  apiError,
} from './middleware.js';
import { canActorAccessPresentation } from '../../../utils/presentation-authz.js';
import { getRateLimitHeaders } from '../../../storage/api-usage.js';

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
 */
async function prepareExportContext(ctx, presentationId) {
  const { repoRoot, url, apiKey } = ctx;
  const exportLang = normalizeLang(url?.searchParams?.get('lang'));

  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) {
    return { ok: false, status: 404, error: 'Presentation not found' };
  }

  if (!(await canActorAccessPresentation(pres, apiKey.ownerEmail, 'read'))) {
    return { ok: false, status: 403, error: 'Access denied to this presentation' };
  }

  const projected = exportLang ? projectPresentationForLang(pres, exportLang) : pres;
  const filteredPres = stripLiveOnlySlidesFromPresentation(projected);
  const theme = await loadTheme(repoRoot, projected?.themeId);
  const langSuffix = getLangSuffix(exportLang);

  // Load merged slide types (core + org-specific custom types)
  const orgId = apiKey?.organizationId || pres?.organizationId || getDefaultOrganizationId();
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
async function sendExportResponse(ctx, { contentType, filename, extension, data }) {
  const { res, apiKey } = ctx;

  const fullFilename = `${safeFilename(filename)}${extension}`;

  // Get rate limit headers
  const rateLimitHeaders = await getRateLimitHeaders(apiKey.id, apiKey.tier, 'exports');

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
  if (!requireScope(ctx, 'export')) return true;

  // Check export limit
  if (!(await checkExportLimit(ctx))) return true;

  const { repoRoot } = ctx;
  const exportCtx = await prepareExportContext(ctx, id);
  if (!exportCtx.ok) {
    await apiError(ctx, exportCtx.status, exportCtx.error);
    return true;
  }

  // Track export
  await trackExportRequest(ctx);

  // Build JSON export
  const deck = presentationToDeck(exportCtx.pres);
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
  if (!requireScope(ctx, 'export')) return true;

  if (!(await checkExportLimit(ctx))) return true;

  const { repoRoot } = ctx;
  const exportCtx = await prepareExportContext(ctx, id);
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
  if (!requireScope(ctx, 'export')) return true;

  if (!(await checkExportLimit(ctx))) return true;

  const { repoRoot } = ctx;
  const exportCtx = await prepareExportContext(ctx, id);
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
  if (!requireScope(ctx, 'export')) return true;

  if (!(await checkExportLimit(ctx))) return true;

  const { repoRoot, url } = ctx;
  const exportCtx = await prepareExportContext(ctx, id);
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
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

/**
 * Main handler for /api/v1/presentations/:id/export/* routes.
 */
export async function handleExports(ctx) {
  const { req, res, url } = ctx;

  // JSON export
  const jsonMatch = url.pathname.match(/^\/api\/v1\/presentations\/([^/]+)\/export\/json$/);
  if (jsonMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleJsonExport(ctx, jsonMatch[1]);
  }

  // HTML export
  const htmlMatch = url.pathname.match(/^\/api\/v1\/presentations\/([^/]+)\/export\/html$/);
  if (htmlMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleHtmlExport(ctx, htmlMatch[1]);
  }

  // PDF export
  const pdfMatch = url.pathname.match(/^\/api\/v1\/presentations\/([^/]+)\/export\/pdf$/);
  if (pdfMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handlePdfExport(ctx, pdfMatch[1]);
  }

  // PPTX export
  const pptxMatch = url.pathname.match(/^\/api\/v1\/presentations\/([^/]+)\/export\/pptx$/);
  if (pptxMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handlePptxExport(ctx, pptxMatch[1]);
  }

  return false;
}
