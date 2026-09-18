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
 *
 * …and the trash: decks trashed longer ago than TRASH_RETENTION_DAYS (30) are
 * purged for good, which is the promise the trash hint makes. It is a
 * scheduled sweep rather than a side effect of opening the trash, so a deck's
 * fate does not depend on whether anyone looked.
 */

import { cleanupOldUsage } from '../storage/api-usage.js';
import { cleanupExpiredShareLinks } from '../storage/share-links/index.js';
import { deleteOldActivityEvents } from '../storage/activity-events.js';
import { cleanupExpiredSlideLocks } from '../storage/slide-locks.js';
import { listTrashedPresentationsBefore } from '../storage/presentations/index.js';
import { crossOrganizationScope } from '../storage/scope.js';
import { permanentlyDeletePresentation } from '../services/permanent-delete.js';
import { createLogger } from '../utils/logger.js';
import { createIntervalJob } from './interval-job.js';
import { repoRoot as defaultRepoRoot } from '../config/paths.js';
import {
  activityRetentionDays,
  trashRetentionDays,
} from '../config/retention.js';

const log = createLogger('retention-cleanup');

// ============================================================
// CONFIGURATION
// ============================================================

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * The timestamp a retention window of `days` reaches back to.
 * @param {number} days
 * @returns {string} ISO timestamp
 */
function cutoffIsoFor(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString();
}

// ============================================================
// CLEANUP
// ============================================================

/**
 * Purge every deck that has been in the trash longer than the retention
 * window. Each deck goes through the same seam as the "Delete permanently"
 * button, one at a time and scoped to its own organization — a write may not
 * be cross-organization, and a bulk `DELETE` would skip the rasters.
 *
 * One cutoff governs the whole sweep: it selects the candidates, and it is
 * handed to every delete so the deadline is re-checked inside the `DELETE`
 * itself. Between selecting a deck and reaching it, a user can restore it and
 * throw it away again; that deck is trashed once more but no longer due, and
 * the guard is what lets it keep its fresh window.
 *
 * One deck's failure does not end the sweep: the next run picks it up again,
 * because the work is defined by the cutoff and not by a cursor. That is also
 * what makes a repeated run idempotent — a purged deck is simply no longer a
 * candidate.
 *
 * @param {Object} options
 * @param {string} options.repoRoot - Repository root, for the thumbnail cache.
 * @param {number} options.retentionDays - Days a trashed deck stays recoverable.
 * @returns {Promise<{purged: number, failed: number}>}
 */
async function purgeExpiredTrash({ repoRoot, retentionDays }) {
  const cutoffIso = cutoffIsoFor(retentionDays);
  const due = await listTrashedPresentationsBefore(
    crossOrganizationScope(
      repoRoot,
      'trash retention sweep: the window is instance configuration, and every ' +
        'purge it performs is scoped to the organization the deck came from',
    ),
    cutoffIso,
  );

  let purged = 0;
  let failed = 0;

  for (const deck of due) {
    try {
      const result = await permanentlyDeletePresentation({
        repoRoot,
        storageScope: { repoRoot, organizationId: deck.organizationId },
        id: deck.id,
        trashedBefore: cutoffIso,
      });
      if (result.ok) {
        purged += 1;
      } else {
        // Restored, re-trashed or purged between the read and the write; not
        // an error, and the deck keeps its rasters.
        log.info(`Skipped ${deck.id}: ${result.reason}`);
      }
    } catch (err) {
      failed += 1;
      log.error(`Failed to purge ${deck.id}: ${err.message}`);
    }
  }

  return { purged, failed };
}

/**
 * Run the retention cleanup job.
 * @param {Object} [options]
 * @param {string} [options.repoRoot] - Repository root, for the thumbnail cache
 * @param {number} [options.activityRetentionDays] - Days to retain activity events
 * @param {number} [options.trashRetentionDays] - Days a trashed deck stays recoverable
 * @returns {Promise<{usage: number, shareLinks: number, activityEvents: number, slideLocks: number, trashedDecks: number}>}
 */
export async function runRetentionCleanup({
  repoRoot = defaultRepoRoot,
  activityRetentionDays: activityDays = activityRetentionDays(),
  trashRetentionDays: trashDays = trashRetentionDays(),
} = {}) {
  log.info('Starting cleanup');

  const usage = await cleanupOldUsage();
  log.info(`Deleted ${usage} old api_usage_daily rows`);

  const shareLinks = await cleanupExpiredShareLinks();
  log.info(`Revoked ${shareLinks} expired share links`);

  const { deleted: activityEvents } = await deleteOldActivityEvents(
    cutoffIsoFor(activityDays),
  );
  log.info(`Deleted ${activityEvents} old activity events`);

  const slideLocks = await cleanupExpiredSlideLocks();
  log.info(`Deleted ${slideLocks} expired slide locks`);

  const { purged: trashedDecks, failed } = await purgeExpiredTrash({
    repoRoot,
    retentionDays: trashDays,
  });
  log.info(
    `Purged ${trashedDecks} decks trashed over ${trashDays} days ago` +
      (failed ? ` (${failed} failed)` : ''),
  );

  log.info('Cleanup complete');

  return { usage, shareLinks, activityEvents, slideLocks, trashedDecks };
}

/**
 * Schedule the retention cleanup job to run daily.
 * @param {Object} [options]
 * @param {string} [options.repoRoot] - Repository root, for the thumbnail cache
 * @param {number} [options.activityRetentionDays] - Days to retain activity events
 * @param {number} [options.trashRetentionDays] - Days a trashed deck stays recoverable
 * @param {number} [options.intervalMs] - Run interval (default: 24 hours)
 * @returns {{stop: () => void}} Job control object
 */
export function scheduleRetentionCleanup({
  repoRoot = defaultRepoRoot,
  activityRetentionDays: activityDays,
  trashRetentionDays: trashDays,
  intervalMs = DEFAULT_INTERVAL_MS,
} = {}) {
  let isRunning = false;

  async function runJob() {
    if (isRunning) {
      log.info('Job already running, skipping');
      return;
    }

    isRunning = true;
    try {
      await runRetentionCleanup({
        repoRoot,
        activityRetentionDays: activityDays,
        trashRetentionDays: trashDays,
      });
    } catch (err) {
      log.error('Job failed:', err.message);
    } finally {
      isRunning = false;
    }
  }

  // Run immediately on start, then every intervalMs.
  return createIntervalJob(runJob, { intervalMs, immediate: true });
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
      console.log(`  Trashed decks purged:         ${result.trashedDecks}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Cleanup failed:', err);
      process.exit(1);
    });
}
