/**
 * Bulk export job worker.
 * Processes bulk backup jobs that export all user presentations into a ZIP.
 *
 * Uses the HEAVY queue with concurrency 1.
 * Stores results as temp file paths with a 2-hour TTL (longer than standard
 * exports since bulk ZIPs can be larger and take longer to download).
 */

import fs from 'node:fs/promises';
import { registerWorker, QUEUE_NAMES } from '../connection.js';
import { buildBulkExport } from '../../../export/bulk-export.js';
import { createNotification } from '../../../storage/notifications.js';
import { broadcastToUser } from '../../../services/notification-events.js';
import { getDefaultOrganizationId } from '../../../config/database.js';
import { getAppBaseUrl } from '../../../config/utils.js';

// Store completed job results temporarily for download
const jobResults = new Map();
const RESULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Track active exports per user (email -> jobId)
const activeExports = new Map();

// Track last completed export per user (email -> { jobId, completedAt })
const lastCompletedExports = new Map();

/**
 * Store a job result for later retrieval.
 * @param {string} jobId - Job ID
 * @param {Object} result - Result data (contains filePath, not buffer)
 */
export function storeResult(jobId, result) {
  jobResults.set(jobId, {
    result,
    storedAt: Date.now(),
  });

  // Schedule cleanup: delete temp file and remove from map
  setTimeout(async () => {
    const entry = jobResults.get(jobId);
    if (entry?.result?.filePath) {
      try {
        await fs.unlink(entry.result.filePath);
      } catch {
        // File may already be deleted
      }
    }
    jobResults.delete(jobId);
  }, RESULT_TTL_MS);
}

/**
 * Get a stored bulk export result.
 * @param {string} jobId - Job ID
 * @returns {Object|null} Result or null
 */
export function getStoredBulkResult(jobId) {
  const entry = jobResults.get(jobId);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.storedAt > RESULT_TTL_MS) {
    jobResults.delete(jobId);
    return null;
  }

  return entry.result;
}

/**
 * Check if a user has an active bulk export.
 * @param {string} userEmail
 * @returns {boolean}
 */
export function hasActiveBulkExport(userEmail) {
  return activeExports.has(userEmail);
}

/**
 * Get the active export job ID for a user.
 * @param {string} userEmail
 * @returns {string|null}
 */
export function getActiveExportJobId(userEmail) {
  return activeExports.get(userEmail) || null;
}

/**
 * Get the last completed export for a user (if result is still available).
 * @param {string} userEmail
 * @returns {{ jobId: string, completedAt: string }|null}
 */
export function getLastCompletedExport(userEmail) {
  const info = lastCompletedExports.get(userEmail);
  if (!info) return null;

  // Only return if the result is still downloadable
  const entry = jobResults.get(info.jobId);
  if (!entry) {
    lastCompletedExports.delete(userEmail);
    return null;
  }

  return info;
}

/**
 * Track an active bulk export for a user.
 * @param {string} userEmail
 * @param {string} jobId
 */
export function trackActiveBulkExport(userEmail, jobId) {
  activeExports.set(userEmail, jobId);
}

/**
 * Clear the active bulk export tracking for a user.
 * @param {string} userEmail
 */
export function clearActiveBulkExport(userEmail) {
  activeExports.delete(userEmail);
}

/**
 * Send notifications after a successful export (non-blocking).
 * @param {Object} params
 * @param {string} params.userEmail
 * @param {string} params.jobId - Full job ID (heavy-xxx)
 * @param {Object} params.manifest
 * @param {string} [params.organizationId]
 * @param {string} [params.repoRoot]
 */
async function sendExportNotifications({ userEmail, jobId, manifest, organizationId, repoRoot }) {
  const stats = manifest?.stats || {};
  const baseUrl = getAppBaseUrl();
  const downloadUrl = `${baseUrl}/settings#export`;

  // 1. In-app notification
  try {
    const ctx = {
      organizationId: organizationId || getDefaultOrganizationId(),
      actorEmail: userEmail,
    };

    const presCount = stats.presentations || 0;
    const result = await createNotification({
      userEmail,
      notificationType: 'export_ready',
      title: 'Your data export is ready',
      body: `${presCount} presentation${presCount !== 1 ? 's' : ''} exported`,
      actionUrl: downloadUrl,
      data: { jobId, size: stats.totalSizeBytes },
    }, ctx);

    // Broadcast via SSE for real-time update
    if (result?.ok && result.notification) {
      broadcastToUser(userEmail, 'notification:new', result.notification);
    }
  } catch (err) {
    console.warn('[bulk-export-worker] In-app notification failed:', err.message);
  }

  // 2. Email notification (lazy import to avoid circular deps)
  try {
    const { sendExportReadyNotification } = await import('../../../integrations/email/senders-export.js');
    await sendExportReadyNotification({
      recipientEmail: userEmail,
      stats,
      downloadUrl,
      repoRoot,
    });
  } catch (err) {
    console.warn('[bulk-export-worker] Email notification failed:', err.message);
  }
}

/**
 * Process a bulk export job.
 * @param {Object} job - BullMQ job
 * @returns {Promise<Object>} Result with download info
 */
async function processBulkExportJob(job) {
  const { repoRoot, userEmail, organizationId, options } = job.data;

  console.log(`[bulk-export-worker] Processing bulk export for ${userEmail}, job ${job.id}`);

  try {
    const { filePath, manifest } = await buildBulkExport({
      repoRoot,
      userEmail,
      organizationId,
      options,
      onProgress: async (pct) => {
        await job.updateProgress(pct);
      },
    });

    // Get file size
    let size = manifest.stats?.totalSizeBytes || 0;
    if (!size) {
      try {
        const stat = await fs.stat(filePath);
        size = stat.size;
      } catch {
        // ignore
      }
    }

    // Store result for download (file path instead of base64 buffer)
    const result = {
      filePath,
      contentType: 'application/zip',
      extension: '-backup.zip',
      filename: 'deckyard',
      size,
      ownerEmail: userEmail,
    };

    storeResult(job.id, result);

    // Track last completed export for this user
    const fullJobId = `heavy-${job.id}`;
    lastCompletedExports.set(userEmail, {
      jobId: job.id,
      completedAt: new Date().toISOString(),
    });

    console.log(
      `[bulk-export-worker] Bulk export complete for ${userEmail}: ` +
      `${manifest.stats.presentations} presentations, ${size} bytes`
    );

    // Send notifications (non-blocking)
    sendExportNotifications({
      userEmail,
      jobId: fullJobId,
      manifest,
      organizationId,
      repoRoot,
    }).catch((err) => {
      console.warn('[bulk-export-worker] Notification error:', err.message);
    });

    return {
      ready: true,
      contentType: 'application/zip',
      extension: '-backup.zip',
      size,
      stats: manifest.stats,
    };
  } finally {
    // Always clear the active export tracking
    clearActiveBulkExport(userEmail);
  }
}

/**
 * Initialize the bulk export worker.
 * @returns {Promise<Object|null>} Worker instance
 */
export async function initializeBulkExportWorker() {
  return registerWorker(
    QUEUE_NAMES.HEAVY,
    processBulkExportJob,
    {
      concurrency: 1,
    }
  );
}
