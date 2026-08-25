import { safeFilename } from '../utils/filename.js';
import { stripLiveOnlySlidesFromPresentation } from '../utils/public-output.js';
import { jsonError, notFound, unauthorized, serveJson } from '../utils/http.js';
import { isAppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { getPresentation } from '../storage/presentations/index.js';
import { normalizeLang, projectPresentationForLang } from '../utils/i18n.js';
import { loadThemeAssets } from '../utils/themes.js';
import { canReadPresentation } from '../utils/presentation-authz/index.js';
import { getCollaboratorPermission } from '../storage/collaborators.js';
import {
  addJob,
  isQueueAvailable,
  QUEUE_NAMES,
} from '../jobs/queue/connection.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';

const log = createLogger('export');

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
function buildExportHeaders({
  contentType,
  filename,
  langSuffix = '',
  extension,
}) {
  const fullFilename = `${safeFilename(filename + langSuffix)}${extension}`;
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fullFilename}"`,
    'Cache-Control': 'no-store',
  };
}

/**
 * Common export context preparation - handles auth, loading, projection.
 * `storageScope` is the request's scope, passed down from the route context —
 * this module never builds one itself.
 * @param {Object} options - Context options
 * @returns {Object} Export context or null if request should be rejected
 */
export async function prepareExportContext({
  repoRoot,
  res,
  url,
  authedUser,
  presentationId,
  storageScope,
  stripLiveOnly = true,
}) {
  const exportLang = normalizeLang(url?.searchParams?.get('lang'));

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) {
    notFound(res);
    return null;
  }

  const collaboratorPermission = authedUser?.email
    ? await getCollaboratorPermission(presentationId, authedUser.email)
    : null;

  if (
    !canReadPresentation({ user: authedUser, pres, collaboratorPermission })
  ) {
    unauthorized(res);
    return null;
  }

  const projected = exportLang
    ? projectPresentationForLang(pres, exportLang)
    : pres;
  const filteredPres = stripLiveOnly
    ? stripLiveOnlySlidesFromPresentation(projected)
    : projected;
  const theme = await loadThemeAssets(repoRoot, projected?.theme);
  const langSuffix = getLangSuffix(exportLang);

  // Load merged slide types (core + org-specific custom types)
  const orgId = authedUser?.organizationId || pres?.organizationId;
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
export function sendExportResponse(
  res,
  { contentType, filename, langSuffix, extension, data },
) {
  const headers = buildExportHeaders({
    contentType,
    filename,
    langSuffix,
    extension,
  });
  res.writeHead(200, headers);
  res.end(data);
}

/**
 * Send HTML export response (no Content-Disposition, for browser preview)
 * @param {Object} res - Response object
 * @param {string} html - HTML content
 */
function sendHtmlPreviewResponse(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

/**
 * Turn a thrown export failure into the canonical error envelope.
 *
 * An `AppError` is a deliberate, user-facing answer — its status and message
 * are the contract, so they pass through unchanged. Anything else is an
 * internal failure (a renderer crash, a missing binary, a bad ZIP): its
 * message carries absolute paths and module layout, so it is logged and the
 * client gets a fixed `export_failed` 500 instead of the raw text
 * (js/stack-trace-exposure). It used to be a 400 with `String(error)` in the
 * body, which was both a leak and the wrong status for a server-side crash.
 *
 * @param {Object} res - Response object
 * @param {Error} error - Error object
 * @returns {true}
 */
export function handleExportError(res, error) {
  if (isAppError(error)) {
    serveJson(res, error.statusCode, error.toJSON());
    return true;
  }
  log.error('Export failed:', error);
  return jsonError(res, 500, 'export_failed', 'Export failed');
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

  return async function handler({
    repoRoot,
    storageScope,
    req,
    res,
    url,
    authedUser,
  }) {
    const match = url.pathname.match(pattern);
    if (!match || req.method !== method) return false;

    const presentationId = match[1];
    const ctx = await prepareExportContext({
      repoRoot,
      res,
      url,
      authedUser,
      presentationId,
      storageScope,
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

  return async function handler({
    repoRoot,
    storageScope,
    req,
    res,
    url,
    authedUser,
  }) {
    const match = url.pathname.match(pattern);
    if (!match || req.method !== method) return false;

    const presentationId = match[1];
    const ctx = await prepareExportContext({
      repoRoot,
      res,
      url,
      authedUser,
      presentationId,
      storageScope,
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

  return async function handler({
    repoRoot,
    storageScope,
    req,
    res,
    url,
    authedUser,
  }) {
    const match = url.pathname.match(pattern);
    if (!match || req.method !== method) return false;

    const presentationId = match[1];

    // Check if user prefers sync (query param ?sync=1)
    const forceSync = url.searchParams.get('sync') === '1';

    // If queue is available and not forcing sync, queue the job
    if (!forceSync && isQueueAvailable()) {
      // Quick auth check
      const pres = await getPresentation(storageScope, presentationId);
      if (!pres) {
        return notFound(res);
      }
      const collaboratorPermission = authedUser?.email
        ? await getCollaboratorPermission(presentationId, authedUser.email)
        : null;
      if (
        !canReadPresentation({ user: authedUser, pres, collaboratorPermission })
      ) {
        return unauthorized(res);
      }

      // Queue the job
      const exportLang = normalizeLang(url.searchParams.get('lang'));
      const scale = Math.max(
        1,
        Math.min(3, Number(url.searchParams.get('scale')) || 2),
      );

      const { jobId, queued } = await addJob(QUEUE_NAMES.EXPORT, exportType, {
        presentationId,
        lang: exportLang,
        stripLiveOnly,
        scale,
        repoRoot,
        // Stamp the requester so the download/status routes can enforce
        // ownership (job IDs are enumerable ints — see security-audit H3), and the
        // organization so the worker acts in the organization the export came from.
        ownerEmail: authedUser?.email || null,
        organizationId: authedUser?.organizationId || undefined,
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
      storageScope,
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
