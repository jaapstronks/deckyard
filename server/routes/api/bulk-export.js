/**
 * Bulk export API route.
 * POST /api/bulk-export — kick off a bulk backup job.
 * GET  /api/bulk-export/status — check for active/completed export.
 *
 * Returns a job ID for status polling via the existing /api/jobs/:id infrastructure.
 */

import { jsonError, requireJsonBody, serveJson, unauthorized, serverError } from '../../utils/http.js';
import { addJob, QUEUE_NAMES } from '../../jobs/queue/connection.js';
import {
  hasActiveBulkExport,
  trackActiveBulkExport,
  storeResult,
  clearActiveBulkExport,
  getActiveExportJobId,
  getLastCompletedExport,
} from '../../jobs/queue/workers/bulk-export-worker.js';
import { buildBulkExport } from '../../export/bulk-export.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('bulk-export');

/**
 * Handle bulk export requests.
 * POST /api/bulk-export
 * GET  /api/bulk-export/status
 */
export async function handleBulkExport({ req, res, url, repoRoot, authedUser }) {
  if (url.pathname === '/api/bulk-export/status' && req.method === 'GET') {
    return handleBulkExportStatus({ res, authedUser });
  }

  if (req.method !== 'POST') return false;
  if (url.pathname !== '/api/bulk-export') return false;

  const userEmail = authedUser?.email;
  if (!userEmail) {
    unauthorized(res, 'Authentication required');
    return true;
  }

  // Rate limit: one active export per user
  if (hasActiveBulkExport(userEmail)) {
    jsonError(
      res,
      429,
      'export_in_progress',
      'A bulk export is already in progress. Please wait for it to complete.'
    );
    return true;
  }

  // Parse request body
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;

  const options = {
    includeVersions: Boolean(parsed.body?.includeVersions),
    includeImageLibrary: Boolean(parsed.body?.includeImageLibrary),
    includeSlideLibrary: Boolean(parsed.body?.includeSlideLibrary),
    includeThemes: Boolean(parsed.body?.includeThemes),
  };

  // Add job to queue
  const { jobId, queued } = await addJob(QUEUE_NAMES.HEAVY, 'bulk-export', {
    repoRoot,
    userEmail,
    organizationId: authedUser?.organizationId || undefined,
    options,
  });

  if (!queued) {
    // Synchronous fallback (no Redis)
    try {
      trackActiveBulkExport(userEmail, jobId);

      const { filePath, manifest } = await buildBulkExport({
        repoRoot,
        userEmail,
        organizationId: authedUser?.organizationId || undefined,
        options,
        onProgress: () => {},
      });

      // Get file size
      let size = manifest.stats?.totalSizeBytes || 0;

      // Store result for download via the sync job ID (file path, not buffer)
      storeResult(jobId, {
        filePath,
        contentType: 'application/zip',
        extension: '-backup.zip',
        filename: 'deckyard',
        size,
        ownerEmail: userEmail,
      });

      const fullJobId = `heavy-${jobId}`;

      return serveJson(res, 200, {
        ok: true,
        jobId: fullJobId,
        statusUrl: `/api/jobs/${fullJobId}`,
        downloadUrl: `/api/jobs/${fullJobId}/download`,
        sync: true,
      });
    } catch (err) {
      log.error('[bulk-export] Sync export failed:', err.message);
      serverError(res, 'Export failed');
      return true;
    } finally {
      clearActiveBulkExport(userEmail);
    }
  }

  // Queued via BullMQ
  trackActiveBulkExport(userEmail, jobId);
  const fullJobId = `heavy-${jobId}`;

  return serveJson(res, 202, {
    ok: true,
    jobId: fullJobId,
    statusUrl: `/api/jobs/${fullJobId}`,
    downloadUrl: `/api/jobs/${fullJobId}/download`,
  });
}

/**
 * Handle bulk export status check.
 * GET /api/bulk-export/status
 * Returns active job info or last completed export info.
 */
function handleBulkExportStatus({ res, authedUser }) {
  const userEmail = authedUser?.email;
  if (!userEmail) {
    unauthorized(res, 'Authentication required');
    return true;
  }

  // Check for active export
  const activeJobId = getActiveExportJobId(userEmail);
  if (activeJobId) {
    const fullJobId = `heavy-${activeJobId}`;
    return serveJson(res, 200, {
      active: true,
      jobId: fullJobId,
      statusUrl: `/api/jobs/${fullJobId}`,
      downloadUrl: `/api/jobs/${fullJobId}/download`,
    });
  }

  // Check for last completed export (still downloadable)
  const lastExport = getLastCompletedExport(userEmail);
  if (lastExport) {
    const fullJobId = `heavy-${lastExport.jobId}`;
    return serveJson(res, 200, {
      active: false,
      lastExport: {
        jobId: fullJobId,
        downloadUrl: `/api/jobs/${fullJobId}/download`,
        completedAt: lastExport.completedAt,
      },
    });
  }

  return serveJson(res, 200, {
    active: false,
    lastExport: null,
  });
}
