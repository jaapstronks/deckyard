/**
 * Job status API.
 * Provides endpoints for checking background job status and retrieving results.
 *
 * Routes:
 * - GET /api/jobs/:id - Get job status
 * - GET /api/jobs/:id/download - Download job result (for export jobs)
 * - GET /api/jobs/queue/:name/stats - Get queue statistics (admin)
 */

import { createReadStream } from 'node:fs';
import { getJobStatus, getQueueStats, QUEUE_NAMES } from '../../jobs/queue/connection.js';
import { getStoredResult } from '../../jobs/queue/workers/export-worker.js';
import { getStoredTranslationResult } from '../../jobs/queue/workers/translate-worker.js';
import { getStoredBulkResult } from '../../jobs/queue/workers/bulk-export-worker.js';
import { serveJson, notFound, badRequest, forbidden } from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import { normalizeEmail } from '../../utils/normalize.js';

/**
 * Parse job ID to extract queue name.
 * Job IDs are prefixed with queue name: export-123, translate-456
 * @param {string} jobId - Full job ID
 * @returns {{queueName: string, id: string}} Parsed ID
 */
function parseJobId(jobId) {
  const parts = jobId.split('-');
  if (parts.length < 2) {
    return { queueName: QUEUE_NAMES.EXPORT, id: jobId };
  }

  const prefix = parts[0];
  const id = parts.slice(1).join('-');

  // Map prefix to queue name
  const queueMap = {
    export: QUEUE_NAMES.EXPORT,
    translate: QUEUE_NAMES.TRANSLATE,
    heavy: QUEUE_NAMES.HEAVY,
  };

  return {
    queueName: queueMap[prefix] || QUEUE_NAMES.EXPORT,
    id: queueMap[prefix] ? id : jobId, // If no prefix match, use full ID
  };
}

/**
 * Look up the stored result for a job across the queue-specific result stores.
 * @param {string} queueName - Queue name from parseJobId
 * @param {string} id - Job id (without queue prefix)
 * @returns {Object|null} Stored result, or null if absent/expired
 */
function getStoredResultForQueue(queueName, id) {
  if (queueName === QUEUE_NAMES.EXPORT) return getStoredResult(id);
  if (queueName === QUEUE_NAMES.TRANSLATE) return getStoredTranslationResult(id);
  if (queueName === QUEUE_NAMES.HEAVY) return getStoredBulkResult(id);
  return null;
}

/**
 * Fail-closed ownership check for a stored job result. Job IDs are enumerable
 * ints, so a result is only accessible to the user whose email is stamped on
 * it. Returns false when either side is missing (security-audit H3).
 * @param {Object|null} result - Stored result (may carry ownerEmail)
 * @param {Object} [authedUser] - Authenticated user
 * @returns {boolean} True only when the caller owns the result
 */
export function ownsStoredResult(result, authedUser) {
  const owner = normalizeEmail(result?.ownerEmail);
  const caller = normalizeEmail(authedUser?.email);
  return !!owner && !!caller && owner === caller;
}

/**
 * Handle job status request.
 * GET /api/jobs/:id
 */
async function handleGetJobStatus({ res, authedUser }, fullJobId) {
  const { queueName, id } = parseJobId(fullJobId);

  // Check if this is a sync job (executed synchronously, no queue)
  if (id.startsWith('sync-')) {
    serveJson(res, 200, {
      id: fullJobId,
      state: 'completed',
      progress: 100,
      message: 'Job completed synchronously (queue unavailable)',
    });
    return true;
  }

  const status = await getJobStatus(queueName, id);

  if (!status) {
    return notFound(res, 'Job not found');
  }

  // Build response
  const response = {
    id: fullJobId,
    state: status.state,
    progress: status.progress || 0,
    attemptsMade: status.attemptsMade,
    createdAt: status.timestamp,
    completedAt: status.finishedOn,
  };

  // Add result info if completed. The return value + download URL expose the
  // export's existence and metadata, so gate them behind ownership; a
  // non-owner (or a caller for whom no owner-stamped result survives) gets the
  // job treated as not found to avoid an enumeration oracle (security-audit H3).
  if (status.state === 'completed' && status.returnvalue) {
    const stored = getStoredResultForQueue(queueName, id);
    if (!ownsStoredResult(stored, authedUser)) {
      return notFound(res, 'Job not found');
    }
    response.result = status.returnvalue;
    if (status.returnvalue.ready) {
      response.downloadUrl = `/api/jobs/${fullJobId}/download`;
    }
  }

  // Add error info if failed
  if (status.state === 'failed') {
    response.error = status.failedReason;
  }

  serveJson(res, 200, response);
  return true;
}

/**
 * Handle job result download.
 * GET /api/jobs/:id/download
 */
async function handleJobDownload({ res, authedUser }, fullJobId) {
  const { queueName, id } = parseJobId(fullJobId);

  // Get stored result based on queue type
  let result = null;
  if (queueName === QUEUE_NAMES.EXPORT) {
    result = getStoredResult(id);
  } else if (queueName === QUEUE_NAMES.TRANSLATE) {
    result = getStoredTranslationResult(id);
  } else if (queueName === QUEUE_NAMES.HEAVY) {
    result = getStoredBulkResult(id);
  }

  if (!result) {
    return notFound(res, 'Job result not found or expired');
  }

  // Fail-closed ownership: job IDs are enumerable, so only the user who
  // requested the export may download it. A missing owner stamp denies access
  // (older cached results re-export cleanly). Same 404 as the not-found case so
  // the response can't confirm another user's job exists (security-audit H3).
  if (!ownsStoredResult(result, authedUser)) {
    return notFound(res, 'Job result not found or expired');
  }

  // For translation jobs, just return the result as JSON
  if (queueName === QUEUE_NAMES.TRANSLATE) {
    serveJson(res, 200, result);
    return true;
  }

  // Build filename
  const filename = result.filename || 'download';
  const langSuffix = result.lang ? `-${result.lang.toUpperCase()}` : '';
  const fullFilename = `${filename}${langSuffix}${result.extension}`;

  // HEAVY queue results are stored as temp files — stream them
  if (queueName === QUEUE_NAMES.HEAVY && result.filePath) {
    const headers = {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fullFilename)}"`,
    };
    if (result.size) {
      headers['Content-Length'] = result.size;
    }
    res.writeHead(200, headers);
    const stream = createReadStream(result.filePath);
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) {
        notFound(res, 'Export file not found');
      } else {
        res.end();
      }
    });
    return true;
  }

  // For standard export jobs, return the buffered file
  const buffer = Buffer.from(result.buffer, 'base64');

  res.writeHead(200, {
    'Content-Type': result.contentType,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(fullFilename)}"`,
    'Content-Length': buffer.length,
  });
  res.end(buffer);
  return true;
}

/**
 * Handle queue statistics request (admin).
 * GET /api/jobs/queue/:name/stats
 */
async function handleQueueStats({ res, authedUser }, queueName) {
  // Require admin
  if (!authedUser?.isAdmin) {
    return forbidden(res, 'Admin access required');
  }

  if (!Object.values(QUEUE_NAMES).includes(queueName)) {
    return badRequest(res, `Unknown queue: ${queueName}`);
  }

  const stats = await getQueueStats(queueName);

  if (!stats) {
    serveJson(res, 200, {
      queueName,
      available: false,
      message: 'Queue not available (Redis not configured)',
    });
    return true;
  }

  serveJson(res, 200, {
    queueName,
    available: true,
    ...stats,
  });
  return true;
}

/**
 * Declarative route table for `/api/jobs*` (A7.19 C8). Order matches the
 * previous chain: `/download` and `/queue/:name/stats` before the bare `/:id`
 * row. Every route is GET-only; a non-GET request matches no row and falls
 * through (Form A), exactly as the chain's module-wide `req.method !== 'GET'`
 * guard did.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: /^\/api\/jobs\/([^/]+)\/download$/, handler: handleJobDownload },
  { method: 'GET', pattern: /^\/api\/jobs\/queue\/([^/]+)\/stats$/, handler: handleQueueStats },
  { method: 'GET', pattern: /^\/api\/jobs\/([^/]+)$/, handler: handleGetJobStatus },
];

/**
 * Main job routes handler. The path-prefix guard runs before dispatch, as the
 * original chain's did.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleJobs(ctx) {
  if (!ctx.url.pathname.startsWith('/api/jobs')) return false;
  return dispatchRoutes(ROUTES, ctx);
}
