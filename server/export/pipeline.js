import { safeFilename } from '../utils/filename.js';
import { stripLiveOnlySlidesFromPresentation } from '../utils/public-output.js';
import { badRequest, notFound, unauthorized, serveJson } from '../utils/http.js';
import { getPresentation } from '../storage/presentations.js';
import { normalizeLang, projectPresentationForLang } from '../utils/i18n.js';
import { loadTheme } from '../utils/themes.js';
import { canReadPresentation } from '../utils/presentation-authz.js';
import { getCollaboratorPermission } from '../storage/collaborators.js';
import { addJob, isQueueAvailable, QUEUE_NAMES } from '../jobs/queue/connection.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { getDefaultOrganizationId } from '../config/database.js';

/**
 * Get the language suffix for filenames based on export language
 * @param {string} exportLang - Export language code
 * @returns {string} Language suffix (e.g., '-NL', '-EN', or '')
 */
export function getLangSuffix(exportLang) {
  return exportLang === 'nl' ? '-NL' : exportLang === 'en-GB' ? '-EN' : '';
}

/**
 * Build export response headers
 * @param {Object} options - Header options
 * @returns {Object} Headers object
 */
export function buildExportHeaders({ contentType, filename, langSuffix = '', extension }) {
  const fullFilename = `${safeFilename(filename + langSuffix)}${extension}`;
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fullFilename}"`,
    'Cache-Control': 'no-store',
  };
}

/**
 * Common export context preparation - handles auth, loading, projection
 * @param {Object} options - Context options
 * @returns {Object} Export context or null if request should be rejected
 */
export async function prepareExportContext({
  repoRoot,
  res,
  url,
  authedUser,
  presentationId,
  stripLiveOnly = true,
}) {
  const exportLang = normalizeLang(url?.searchParams?.get('lang'));

  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) {
    notFound(res);
    return null;
  }

  const collaboratorPermission = authedUser?.email
    ? await getCollaboratorPermission(presentationId, authedUser.email, {})
    : null;

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    unauthorized(res);
    return null;
  }

  const projected = exportLang ? projectPresentationForLang(pres, exportLang) : pres;
  const filteredPres = stripLiveOnly ? stripLiveOnlySlidesFromPresentation(projected) : projected;
  const theme = await loadTheme(repoRoot, projected?.theme);
  const langSuffix = getLangSuffix(exportLang);

  // Load merged slide types (core + org-specific custom types)
  const orgId = authedUser?.organizationId || pres?.organizationId || getDefaultOrganizationId();
  const slideTypes = await buildMergedSlideTypes({ organizationId: orgId });

  return {
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
 * Parse scale parameter from URL
 * @param {URL} url - Request URL
 * @param {number} defaultScale - Default scale (default: 2)
 * @returns {number} Validated scale between 1-3
 */
export function parseScaleParam(url, defaultScale = 2) {
  const scaleParam = url.searchParams.get('scale');
  return Math.max(1, Math.min(3, Number(scaleParam) || defaultScale));
}

/**
 * Send successful export response
 * @param {Object} res - Response object
 * @param {Object} options - Response options
 */
export function sendExportResponse(res, { contentType, filename, langSuffix, extension, data }) {
  const headers = buildExportHeaders({ contentType, filename, langSuffix, extension });
  res.writeHead(200, headers);
  res.end(data);
}

/**
 * Send HTML export response (no Content-Disposition, for browser preview)
 * @param {Object} res - Response object
 * @param {string} html - HTML content
 */
export function sendHtmlPreviewResponse(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

/**
 * Handle export error
 * @param {Object} res - Response object
 * @param {Error} error - Error object
 */
export function handleExportError(res, error) {
  return badRequest(res, String(error?.message || error));
}

/**
 * Create an export route handler with common boilerplate
 * @param {Object} config - Route configuration
 * @returns {Function} Route handler
 */
export function createExportRoute(config) {
  const {
    pattern,
    method = 'GET',
    contentType,
    extension,
    stripLiveOnly = true,
    buildContent,
    getFilename = (ctx) => ctx.title,
  } = config;

  return async function handler({ repoRoot, req, res, url, authedUser }) {
    const match = url.pathname.match(pattern);
    if (!match || req.method !== method) return false;

    const presentationId = match[1];
    const ctx = await prepareExportContext({
      repoRoot,
      res,
      url,
      authedUser,
      presentationId,
      stripLiveOnly,
    });

    if (!ctx) return true; // Request was rejected, response already sent

    try {
      const data = await buildContent(ctx, { repoRoot, url, match });
      const filename = getFilename(ctx);

      sendExportResponse(res, {
        contentType,
        filename,
        langSuffix: ctx.langSuffix,
        extension,
        data,
      });
      return true;
    } catch (e) {
      handleExportError(res, e);
      return true;
    }
  };
}

/**
 * Create an HTML preview export route (no download, just render)
 * @param {Object} config - Route configuration
 * @returns {Function} Route handler
 */
export function createHtmlPreviewRoute(config) {
  const { pattern, method = 'GET', stripLiveOnly = true, buildHtml } = config;

  return async function handler({ repoRoot, req, res, url, authedUser }) {
    const match = url.pathname.match(pattern);
    if (!match || req.method !== method) return false;

    const presentationId = match[1];
    const ctx = await prepareExportContext({
      repoRoot,
      res,
      url,
      authedUser,
      presentationId,
      stripLiveOnly,
    });

    if (!ctx) return true;

    try {
      const html = await buildHtml(ctx, { repoRoot, url, match });
      sendHtmlPreviewResponse(res, html);
      return true;
    } catch (e) {
      handleExportError(res, e);
      return true;
    }
  };
}

/**
 * Alias for stripLiveOnlySlidesFromPresentation (for use by workers).
 * @param {Object} pres - Presentation object
 * @returns {Object} Presentation with live-only slides removed
 */
export function stripLiveOnlySlides(pres) {
  return stripLiveOnlySlidesFromPresentation(pres);
}

/**
 * Create an async export route that queues jobs when available.
 * Falls back to synchronous export if queue is unavailable.
 * @param {Object} config - Route configuration
 * @returns {Function} Route handler
 */
export function createAsyncExportRoute(config) {
  const {
    pattern,
    method = 'GET',
    contentType,
    extension,
    exportType, // 'pptx', 'handoff-zip', etc.
    stripLiveOnly = true,
    buildContent, // Fallback sync builder
    getFilename = (ctx) => ctx.title,
  } = config;

  return async function handler({ repoRoot, req, res, url, authedUser }) {
    const match = url.pathname.match(pattern);
    if (!match || req.method !== method) return false;

    const presentationId = match[1];

    // Check if user prefers sync (query param ?sync=1)
    const forceSync = url.searchParams.get('sync') === '1';

    // If queue is available and not forcing sync, queue the job
    if (!forceSync && isQueueAvailable()) {
      // Quick auth check
      const pres = await getPresentation(repoRoot, presentationId);
      if (!pres) {
        return notFound(res);
      }
      const collaboratorPermission = authedUser?.email
        ? await getCollaboratorPermission(presentationId, authedUser.email, {})
        : null;
      if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
        return unauthorized(res);
      }

      // Queue the job
      const exportLang = normalizeLang(url.searchParams.get('lang'));
      const scale = Math.max(1, Math.min(3, Number(url.searchParams.get('scale')) || 2));

      const { jobId, queued } = await addJob(QUEUE_NAMES.EXPORT, exportType, {
        presentationId,
        lang: exportLang,
        stripLiveOnly,
        scale,
        repoRoot,
      });

      if (queued) {
        return serveJson(res, 202, {
          queued: true,
          jobId: `export-${jobId}`,
          pollUrl: `/api/jobs/export-${jobId}`,
          message: 'Export queued. Poll the status URL for completion.',
        });
      }
    }

    // Fallback to synchronous export
    const ctx = await prepareExportContext({
      repoRoot,
      res,
      url,
      authedUser,
      presentationId,
      stripLiveOnly,
    });

    if (!ctx) return true;

    try {
      const data = await buildContent(ctx, { repoRoot, url, match });
      const filename = getFilename(ctx);

      sendExportResponse(res, {
        contentType,
        filename,
        langSuffix: ctx.langSuffix,
        extension,
        data,
      });
      return true;
    } catch (e) {
      handleExportError(res, e);
      return true;
    }
  };
}