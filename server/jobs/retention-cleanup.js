/**
 * Retention cleanup job.
 *
 * Runs the storage-level cleanups that trim data which otherwise grows without
 * bound — several of them carry personal data (actor emails on activity
 * events), so leaving them unwired is a GDPR-shaped liability, not just disk.
 *
 * Covers four tables the analytics cleanup does not:
 *  - api_usage_daily   — rate-limit accounting, kept 90 days (in the query).
 *  - presentation_share_links — expired links flipped to revoked every run.
 *  - activity_events   — organization feed, kept ACTIVITY_RETENTION_DAYS (180).
 *  - slide_locks       — expired collaboration locks, deleted every run.
 */

import { cleanupOldUsage } from '../storage/api-usage.js';
import { cleanupExpiredShareLinks } from '../storage/share-links/index.js';
import { deleteOldActivityEvents } from '../storage/activity-events.js';
import { cleanupExpiredSlideLocks } from '../storage/slide-locks.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('retention-cleanup');

// ============================================================
// CONFIGURATION
// ============================================================

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Activity events carry actor emails; keep them long enough to be a useful feed
// but not indefinitely. Override with ACTIVITY_RETENTION_DAYS.
const ACTIVITY_RETENTION_DAYS =
  parseInt(process.env.ACTIVITY_RETENTION_DAYS || '', 10) || 180;

// ============================================================
// CLEANUP
// ============================================================

/**
 * Run the retention cleanup job.
 * @param {Object} [options]
 * @param {number} [options.activityRetentionDays] - Days to retain activity events
 * @returns {Promise<{usage: number, shareLinks: number, activityEvents: number, slideLocks: number}>}
 */
export async function runRetentionCleanup({
  activityRetentionDays = ACTIVITY_RETENTION_DAYS,
} = {}) {
  log.info('Starting cleanup');

  const usage = await cleanupOldUsage();
  log.info(`Deleted ${usage} old api_usage_daily rows`);

  const shareLinks = await cleanupExpiredShareLinks();
  log.info(`Revoked ${shareLinks} expired share links`);

  const activityCutoff = new Date();
  activityCutoff.setDate(activityCutoff.getDate() - activityRetentionDays);
  const { deleted: activityEvents } = await deleteOldActivityEvents(
    activityCutoff.toISOString()
  );
  log.info(`Deleted ${activityEvents} old activity events`);

  const slideLocks = await cleanupExpiredSlideLocks();
  log.info(`Deleted ${slideLocks} expired slide locks`);

  log.info('Cleanup complete');

  return { usage, shareLinks, activityEvents, slideLocks };
}

/**
 * Schedule the retention cleanup job to run daily.
 * @param {Object} [options]
 * @param {number} [options.activityRetentionDays] - Days to retain activity events
 * @param {number} [options.intervalMs] - Run interval (default: 24 hours)
 * @returns {{stop: () => void}} Job control object
 */
export function scheduleRetentionCleanup({
  activityRetentionDays = ACTIVITY_RETENTION_DAYS,
  intervalMs = DEFAULT_INTERVAL_MS,
} = {}) {
  let intervalId = null;
  let isRunning = false;

  async function runJob() {
    if (isRunning) {
      log.info('Job already running, skipping');
      return;
    }

    isRunning = true;
    try {
      await runRetentionCleanup({ activityRetentionDays });
    } catch (err) {
      log.error('Job failed:', err.message);
    } finally {
      isRunning = false;
    }
  }

  // Run immediately on start
  runJob();

  // Schedule recurring runs
  intervalId = setInterval(runJob, intervalMs);
  intervalId.unref?.(); // Don't keep process alive just for this

  return {
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}

// ============================================================
// CLI SUPPORT
// ============================================================

// Run directly with `node retention-cleanup.js`
if (process.argv[1]?.endsWith('retention-cleanup.js')) {
  runRetentionCleanup()
    .then((result) => {
      console.log(`\nSummary:`);
      console.log(`  api_usage_daily rows deleted: ${result.usage}`);
      console.log(`  Expired share links revoked:  ${result.shareLinks}`);
      console.log(`  Activity events deleted:      ${result.activityEvents}`);
      console.log(`  Expired slide locks deleted:  ${result.slideLocks}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Cleanup failed:', err);
      process.exit(1);
    });
}
