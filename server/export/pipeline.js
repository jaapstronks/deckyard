import { randomUUID } from 'node:crypto';
import { safeFilename } from '../utils/filename.js';
import { jsonError, serveJson } from '../utils/http.js';
import { isAppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { clientDisconnectSignal } from '../utils/client-disconnect.js';
import { openSseStream, sseError, sseWrite } from '../utils/sse.js';
import {
  addJob,
  isQueueAvailable,
  QUEUE_NAMES,
} from '../jobs/queue/connection.js';
import { INSTANCE_HEALTH_KEYS } from '../storage/instance-health.js';
import { prepareExportContext } from '../services/exports.js';
import {
  DOCUMENT_CREEP_MS_PER_SLIDE,
  EXPORT_PROGRESS,
  exportStatus,
} from './progress.js';
import { STREAM_RESULT_TTL_MS, storeExportResult } from './result-store.js';

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
  headers = {},
}) {
  const fullFilename = `${safeFilename(filename + langSuffix)}${extension}`;
  return {
    ...headers,
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fullFilename}"`,
    'Cache-Control': 'no-store',
  };
}

/**
 * The export context for a request on the internal contract: the session user
 * asks, `?lang=` names the language and `?slides=` the slides (B871). A
 * refusal throws (D255); the route's catch answers it through
 * {@link handleExportError}.
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
      slides: url?.searchParams?.get('slides'),
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
  { contentType, filename, langSuffix, extension, data, headers },
) {
  res.writeHead(
    200,
    buildExportHeaders({
      contentType,
      filename,
      langSuffix,
      extension,
      headers,
    }),
  );
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
 * The path of a route's streamed twin: the same pattern with `/stream`
 * appended, so `export/png.zip` streams at `export/png.zip/stream`.
 *
 * @param {RegExp} pattern
 * @returns {RegExp}
 */
export function streamPattern(pattern) {
  return new RegExp(pattern.source.replace(/\$$/, '\\/stream$'));
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
 * The catch of a file export route: a client that left cancelled the export,
 * so it is an info line and no answer (its socket is gone); anything else is
 * {@link handleExportError}.
 *
 * @param {Object} res - Response object
 * @param {Error} error - Error object
 * @param {AbortSignal} signal - The route's {@link clientDisconnectSignal}
 * @param {string} format - Export format, for the log line
 * @returns {true}
 */
function answerFileExportError(res, error, signal, format) {
  if (signal.aborted) {
    log.info(`${format} export cancelled by the client`);
    return true;
  }
  return handleExportError(res, error);
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
      // A client that leaves stops the render, and its catch is a cancel.
      const signal = clientDisconnectSignal(res);
      try {
        const ctx = await exportContextFor(
          { storageScope, authedUser, url },
          presentationId,
          { format, stripLiveOnly, allLanguages },
        );
        const data = await buildContent(ctx, { repoRoot, url, signal });
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
        return answerFileExportError(res, e, signal, format);
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
    // Extra response headers for a synchronous answer, read from the context
    // after `buildContent` ran: a finding about the file that the file itself
    // cannot carry. A queued export answers 202 and has none.
    responseHeaders = () => ({}),
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
      // A client that leaves stops a synchronous render, and its catch is a
      // cancel.
      const signal = clientDisconnectSignal(res);

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
              format,
              exportAccess: ctx.exportAccess,
              lang: ctx.exportLang,
              slides: url.searchParams.get('slides'),
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
        const data = await buildContent(ctx, { repoRoot, url, signal });
        const filename = getFilename(ctx);

        sendExportResponse(res, {
          contentType,
          filename,
          langSuffix: ctx.langSuffix,
          extension,
          data,
          headers: responseHeaders(ctx),
        });
        return true;
      } catch (e) {
        return answerFileExportError(res, e, signal, format);
      }
    },
  );
}

/**
 * The streamed twin of a Chrome export route, at `<pattern>/stream` (B716).
 *
 * The file routes answer with the file, which tells the waiting user nothing
 * for the minute a 54-slide PowerPoint takes. This twin answers with an event
 * stream instead:
 *
 * - `status` `{ phase, progress, done?, total?, unit?, creepTo?, creepMs? }`,
 *   on the export ladder (`export/progress.js`): once at the start, then one
 *   per rendered slide. A route that cannot count (`creep: true`, the PDF)
 *   sends one status that creeps.
 * - `complete` `{ downloadUrl }`: the file is held in the export result store
 *   for its one download through `/api/jobs/export-<id>/download`, owner-gated
 *   as a queued export is.
 * - `error` `{ message, error }` (`api-error-format.md` § SSE error events):
 *   an `AppError`'s sentence and code, or `export_failed` for a crash.
 *
 * Closing the stream is cancelling: the stream's signal reaches the builder,
 * which stops before the next slide and closes the page in flight, and the
 * log says how far it got (`png-zip export cancelled after 3/54`). A refusal
 * before the work starts (no access, unknown deck) is the ordinary JSON
 * envelope, because no stream is open yet.
 *
 * The config is the file route's own, so the two cannot drift: the same
 * builder, filename and response headers.
 *
 * @param {Object} config - as for {@link createExportRoute}, plus `creep`
 * @returns {import('../utils/router.js').Route}
 */
export function createExportStreamRoute(config) {
  const {
    format,
    pattern,
    contentType,
    extension,
    stripLiveOnly = true,
    buildContent,
    responseHeaders = () => ({}),
    getFilename = (ctx) => ctx.title,
    creep = false,
  } = config;
  assertExportFormat(format, pattern);

  return exportRow(
    'GET',
    streamPattern(pattern),
    async function handler(
      { repoRoot, storageScope, req, res, url, authedUser },
      presentationId,
    ) {
      let ctx;
      try {
        ctx = await exportContextFor(
          { storageScope, authedUser, url },
          presentationId,
          { format, stripLiveOnly },
        );
      } catch (e) {
        handleExportError(res, e);
        return true;
      }

      // Authenticated, and it ends with the export it reports on: the
      // public-stream cap is not its bound.
      const stream = openSseStream(req, res, { guard: false });
      if (!stream.ok) return true;

      const slideCount = ctx.filteredPres?.slides?.length || 0;
      let last = { done: 0, total: slideCount };
      sseWrite(res, {
        event: 'status',
        data: creep
          ? {
              phase: 'render',
              progress: EXPORT_PROGRESS.start,
              creepTo: EXPORT_PROGRESS.renderCeiling,
              creepMs: Math.max(3000, slideCount * DOCUMENT_CREEP_MS_PER_SLIDE),
            }
          : { phase: 'start', progress: EXPORT_PROGRESS.start },
      });
      const onProgress = (step) => {
        last = step;
        sseWrite(res, { event: 'status', data: exportStatus(step) });
      };

      try {
        const data = await buildContent(ctx, {
          repoRoot,
          url,
          onProgress,
          signal: stream.signal,
        });
        stream.signal.throwIfAborted();
        const id = `stream-${randomUUID()}`;
        storeExportResult(
          id,
          {
            buffer: Buffer.isBuffer(data) ? data : Buffer.from(data),
            contentType,
            extension,
            filename: getFilename(ctx),
            langSuffix: ctx.langSuffix,
            ownerEmail: authedUser?.email || null,
            exportAccess: ctx.exportAccess,
            headers: responseHeaders(ctx),
            once: true,
          },
          { ttlMs: STREAM_RESULT_TTL_MS },
        );
        sseWrite(res, {
          event: 'complete',
          data: { downloadUrl: `/api/jobs/export-${id}/download` },
        });
      } catch (e) {
        if (stream.signal.aborted) {
          log.info(
            `${format} export cancelled after ${last.done}/${last.total}`,
          );
        } else if (isAppError(e)) {
          sseError(res, e.message, { error: e.code });
        } else {
          log.error('Export failed:', e);
          sseError(res, 'Export failed', { error: 'export_failed' });
        }
      } finally {
        stream.close();
        if (!res.writableEnded) res.end();
      }
      return true;
    },
  );
}
