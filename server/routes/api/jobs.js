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
import { serveJson, notFound, badRequest } from '../../utils/http.js';

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
 * Handle job status request.
 * GET /api/jobs/:id
 */
async function handleGetJobStatus({ res, url }) {
  const match = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (!match) return false;

  const fullJobId = match[1];
  const { queueName, id } = parseJobId(fullJobId);

  // Check if this is a sync job (executed synchronously, no queue)
  if (id.startsWith('sync-')) {
    return serveJson(res, 200, {
      id: fullJobId,
      state: 'completed',
      progress: 100,
      message: 'Job completed synchronously (queue unavailable)',
    });
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

  // Add result info if completed
  if (status.state === 'completed' && status.returnvalue) {
    response.result = status.returnvalue;
    if (status.returnvalue.ready) {
      response.downloadUrl = `/api/jobs/${fullJobId}/download`;
    }
  }

  // Add error info if failed
  if (status.state === 'failed') {
    response.error = status.failedReason;
  }

  return serveJson(res, 200, response);
}

/**
 * Handle job result download.
 * GET /api/jobs/:id/download
 */
async function handleJobDownload({ res, url, authedUser }) {
  const match = url.pathname.match(/^\/api\/jobs\/([^/]+)\/download$/);
  if (!match) return false;

  const fullJobId = match[1];
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

  // Verify ownership for bulk exports (HEAVY queue stores sensitive user data)
  if (result.ownerEmail && authedUser?.email !== result.ownerEmail) {
    return serveJson(res, 403, { error: 'You do not have access to this export' });
  }

  // For translation jobs, just return the result as JSON
  if (queueName === QUEUE_NAMES.TRANSLATE) {
    return serveJson(res, 200, result);
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
async function handleQueueStats({ res, url, authedUser }) {
  const match = url.pathname.match(/^\/api\/jobs\/queue\/([^/]+)\/stats$/);
  if (!match) return false;

  // Require admin
  if (!authedUser?.isAdmin) {
    return serveJson(res, 403, { error: 'Admin access required' });
  }

  const queueName = match[1];

  if (!Object.values(QUEUE_NAMES).includes(queueName)) {
    return badRequest(res, `Unknown queue: ${queueName}`);
  }

  const stats = await getQueueStats(queueName);

  if (!stats) {
    return serveJson(res, 200, {
      queueName,
      available: false,
      message: 'Queue not available (Redis not configured)',
    });
  }

  return serveJson(res, 200, {
    queueName,
    available: true,
    ...stats,
  });
}

/**
 * Main job routes handler.
 */
export async function handleJobs(context) {
  const { req, url } = context;

  if (req.method !== 'GET') return false;
  if (!url.pathname.startsWith('/api/jobs')) return false;

  // Route to specific handler
  if (url.pathname.match(/^\/api\/jobs\/[^/]+\/download$/)) {
    return handleJobDownload(context);
  }

  if (url.pathname.match(/^\/api\/jobs\/queue\/[^/]+\/stats$/)) {
    return handleQueueStats(context);
  }

  if (url.pathname.match(/^\/api\/jobs\/[^/]+$/)) {
    return handleGetJobStatus(context);
  }

  return false;
}
