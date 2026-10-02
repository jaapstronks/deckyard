import { safeFilename } from '../utils/filename.js';
import { jsonError, serveJson } from '../utils/http.js';
import { isAppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import {
  addJob,
  isQueueAvailable,
  QUEUE_NAMES,
} from '../jobs/queue/connection.js';
import { INSTANCE_HEALTH_KEYS } from '../storage/instance-health.js';
import { prepareExportContext } from '../services/exports.js';

const log = createLogger('export');

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
 * The export context for a request on the internal contract: the session user
 * asks, `?lang=` names the language. A refusal throws (D255); the route's
 * catch answers it through {@link handleExportError}.
 *
 * @param {{ storageScope: Object, authedUser: Object, url: URL }} reqCtx
 * @param {string} presentationId
 * @param {{ format: string, stripLiveOnly: boolean, allLanguages?: boolean }} options
 * @returns {Promise<import('../services/exports.js').ExportContext>}
 */
export function exportContextFor(
  { storageScope, authedUser, url },
  presentationId,
  { format, stripLiveOnly, allLanguages = false },
) {
  return prepareExportContext(
    storageScope,
    { actor: authedUser },
    {
      presentationId,
      format,
      lang: url?.searchParams?.get('lang'),
      allLanguages,
      stripLiveOnly,
    },
  );
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
 * One export route as a row of the `/api/*` route table.
 *
 * Every export pattern captures exactly the presentation id, and the
 * dispatcher shape-checks it (`captures`, B360/B399): a non-uuid answers
 * `not_found` before `getPresentation` can hand it to the uuid column.
 * Matching is the dispatcher's job — the factories below build the handler,
 * they do not test the path themselves.
 *
 * @param {string} method
 * @param {RegExp} pattern - One capture group: the presentation id.
 * @param {(ctx: object, presentationId: string) => Promise<unknown>} handler
 * @returns {import('../utils/router.js').Route}
 */
function exportRow(method, pattern, handler) {
  return { method, pattern, captures: ['uuid'], handler };
}

/**
 * Refuse a factory config without a known format id when the table is built,
 * not when the first export is counted: a row the `export` axis cannot name
 * would count nothing, or throw on every request.
 *
 * @param {unknown} format
 * @param {RegExp} pattern
 * @returns {void}
 * @throws {TypeError}
 */
function assertExportFormat(format, pattern) {
  if (!INSTANCE_HEALTH_KEYS.export.includes(/** @type {string} */ (format))) {
    throw new TypeError(
      `export route ${pattern} declares no known format (got '${format}')`,
    );
  }
}

/**
 * Create an export route with common boilerplate.
 * @param {Object} config - Route configuration
 * @returns {import('../utils/router.js').Route}
 */
export function createExportRoute(config) {
  const {
    format,
    pattern,
    method = 'GET',
    contentType,
    extension,
    stripLiveOnly = true,
    allLanguages = false,
    buildContent,
    getFilename = (ctx) => ctx.title,
  } = config;
  assertExportFormat(format, pattern);

  return exportRow(
    method,
    pattern,
    async function handler(
      { repoRoot, storageScope, res, url, authedUser },
      presentationId,
    ) {
      try {
        const ctx = await exportContextFor(
          { storageScope, authedUser, url },
          presentationId,
          { format, stripLiveOnly, allLanguages },
        );
        const data = await buildContent(ctx, { repoRoot, url });
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
    },
  );
}

/**
 * Create an HTML preview export route (no download, just render)
 * @param {Object} config - Route configuration
 * @returns {import('../utils/router.js').Route}
 */
export function createHtmlPreviewRoute(config) {
  const {
    format,
    pattern,
    method = 'GET',
    stripLiveOnly = true,
    buildHtml,
  } = config;
  assertExportFormat(format, pattern);

  return exportRow(
    method,
    pattern,
    async function handler(
      { repoRoot, storageScope, res, url, authedUser },
      presentationId,
    ) {
      try {
        const ctx = await exportContextFor(
          { storageScope, authedUser, url },
          presentationId,
          { format, stripLiveOnly },
        );
        const html = await buildHtml(ctx, { repoRoot, url });
        sendHtmlPreviewResponse(res, html);
        return true;
      } catch (e) {
        handleExportError(res, e);
        return true;
      }
    },
  );
}

/**
 * Create an async export route that queues jobs when available.
 * Falls back to synchronous export if queue is unavailable.
 * @param {Object} config - Route configuration
 * @returns {import('../utils/router.js').Route}
 */
export function createAsyncExportRoute(config) {
  const {
    format,
    pattern,
    method = 'GET',
    contentType,
    extension,
    exportType, // 'pptx', 'handoff-zip', etc.
    stripLiveOnly = true,
    buildContent, // Fallback sync builder
    // Builder options read from the request that the worker cannot read
    // itself: it has the job data, not the URL. Throws to refuse the request.
    jobOptions = () => ({}),
    getFilename = (ctx) => ctx.title,
  } = config;
  assertExportFormat(format, pattern);

  return exportRow(
    method,
    pattern,
    async function handler(
      { repoRoot, storageScope, res, url, authedUser },
      presentationId,
    ) {
      // Check if user prefers sync (query param ?sync=1)
      const forceSync = url.searchParams.get('sync') === '1';

      try {
        const ctx = await exportContextFor(
          { storageScope, authedUser, url },
          presentationId,
          { format, stripLiveOnly },
        );
        const options = jobOptions(url);

        // If queue is available and not forcing sync, queue the job; the
        // worker rebuilds the context as the system from what was admitted.
        if (!forceSync && isQueueAvailable()) {
          const { jobId, queued } = await addJob(
            QUEUE_NAMES.EXPORT,
            exportType,
            {
              presentationId,
              lang: ctx.exportLang,
              stripLiveOnly,
              scale: parseScaleParam(url),
              options,
              repoRoot,
              // Stamp the requester so the download/status routes can enforce
              // ownership (job IDs are enumerable ints — see security-audit
              // H3), and the organization so the worker acts in the
              // organization the export came from.
              ownerEmail: authedUser?.email || null,
              organizationId: authedUser?.organizationId || undefined,
            },
          );
          if (queued) {
            return serveJson(res, 202, {
              queued: true,
              jobId: `export-${jobId}`,
              pollUrl: `/api/jobs/export-${jobId}`,
              message: 'Export queued. Poll the status URL for completion.',
            });
          }
        }

        // Synchronous export: forced, or no queue to take it.
        const data = await buildContent(ctx, { repoRoot, url });
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
    },
  );
}
