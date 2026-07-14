/**
 * Analytics cleanup job.
 * Deletes old view sessions and slide views based on retention policy.
 *
 * Default retention: 90 days for raw data.
 * Analytics snapshots are retained indefinitely.
 */

import { deleteOldViewSessions, anonymizeOldIpAddresses } from '../storage/analytics/view-sessions.js';
import { deleteOldSlideViews } from '../storage/analytics/slide-views.js';
import { anonymizeExpiredLeads, anonymizeOldLeadIpAddresses } from '../storage/leads.js';
import { ANALYTICS_CONFIG } from '../analytics/helpers.js';

/**
 * Run the analytics cleanup job.
 * @param {Object} options
 * @param {number} [options.retentionDays] - Number of days to retain data
 * @param {number} [options.ipAnonymizationDays] - Number of days before IP anonymization
 * @returns {Promise<{deletedSessions: number, deletedSlideViews: number, anonymizedIps: number, anonymizedLeads: number, anonymizedLeadIps: number}>}
 */
export async function runAnalyticsCleanup({
  retentionDays = ANALYTICS_CONFIG.RETENTION_DAYS,
  ipAnonymizationDays = ANALYTICS_CONFIG.IP_ANONYMIZATION_DAYS,
} = {}) {
  // Calculate cutoff dates
  const deletionCutoff = new Date();
  deletionCutoff.setDate(deletionCutoff.getDate() - retentionDays);
  const deletionDate = deletionCutoff.toISOString();

  const ipCutoff = new Date();
  ipCutoff.setDate(ipCutoff.getDate() - ipAnonymizationDays);
  const ipAnonymizationDate = ipCutoff.toISOString();

  console.log(`[analytics-cleanup] Starting cleanup`);
  console.log(`[analytics-cleanup] - Deleting data older than ${deletionDate}`);
  console.log(`[analytics-cleanup] - Anonymizing IPs older than ${ipAnonymizationDate}`);

  // Anonymize IP addresses first (for data we're keeping but need to anonymize)
  const ipResult = await anonymizeOldIpAddresses(ipAnonymizationDate);
  console.log(`[analytics-cleanup] Anonymized ${ipResult.anonymized} IP addresses`);

  // Delete old slide views first (they reference view_sessions)
  const slideViewsResult = await deleteOldSlideViews(deletionDate);
  console.log(`[analytics-cleanup] Deleted ${slideViewsResult.deleted} slide views`);

  // Delete old view sessions
  const sessionsResult = await deleteOldViewSessions(deletionDate);
  console.log(`[analytics-cleanup] Deleted ${sessionsResult.deleted} view sessions`);

  // Anonymize expired leads (based on per-lead retention_expires_at)
  const leadsResult = await anonymizeExpiredLeads();
  console.log(`[analytics-cleanup] Anonymized ${leadsResult.anonymized} expired leads`);

  // Anonymize old lead IP addresses (same policy as view sessions)
  const leadIpsResult = await anonymizeOldLeadIpAddresses(ipAnonymizationDate);
  console.log(`[analytics-cleanup] Anonymized ${leadIpsResult.anonymized} lead IP addresses`);

  console.log(`[analytics-cleanup] Cleanup complete`);

  return {
    deletedSessions: sessionsResult.deleted,
    deletedSlideViews: slideViewsResult.deleted,
    anonymizedIps: ipResult.anonymized,
    anonymizedLeads: leadsResult.anonymized,
    anonymizedLeadIps: leadIpsResult.anonymized,
  };
}

/**
 * Schedule the cleanup job to run daily.
 * @param {Object} options
 * @param {number} [options.retentionDays] - Retention period
 * @param {number} [options.ipAnonymizationDays] - IP anonymization period
 * @param {number} [options.intervalMs] - Run interval (default: 24 hours)
 * @returns {Object} Job control object with stop method
 */
export function scheduleAnalyticsCleanup({
  retentionDays = ANALYTICS_CONFIG.RETENTION_DAYS,
  ipAnonymizationDays = ANALYTICS_CONFIG.IP_ANONYMIZATION_DAYS,
  intervalMs = 24 * 60 * 60 * 1000, // 24 hours
} = {}) {
  let intervalId = null;
  let isRunning = false;

  async function runJob() {
    if (isRunning) {
      console.log('[analytics-cleanup] Job already running, skipping');
      return;
    }

    isRunning = true;
    try {
      await runAnalyticsCleanup({ retentionDays, ipAnonymizationDays });
    } catch (err) {
      console.error('[analytics-cleanup] Job failed:', err.message);
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

// CLI support: run directly with `node analytics-cleanup.js`
if (process.argv[1]?.endsWith('analytics-cleanup.js')) {
  // CLI can override via environment variables (already handled in ANALYTICS_CONFIG)
  runAnalyticsCleanup()
    .then((result) => {
      console.log(`Deleted ${result.deletedSessions} sessions and ${result.deletedSlideViews} slide views`);
      console.log(`Anonymized ${result.anonymizedIps} IP addresses`);
      console.log(`Anonymized ${result.anonymizedLeads} expired leads and ${result.anonymizedLeadIps} lead IP addresses`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Cleanup failed:', err);
      process.exit(1);
    });
}