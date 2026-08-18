/**
 * Analytics cleanup job.
 * Deletes old view sessions and slide views based on retention policy.
 *
 * Retention is read from instance settings on every run
 * (`settings.analytics.retention.*` via getAnalyticsRetention), so a change in
 * the admin UI takes effect on the next daily pass without a restart. Defaults
 * (90 days raw data, 7 days IP anonymization) are seeded from env; see
 * `server/storage/settings.js`.
 */

import { deleteOldViewSessions, anonymizeOldIpAddresses } from '../storage/analytics/view-sessions.js';
import { deleteOldSlideViews } from '../storage/analytics/slide-views.js';
import { anonymizeExpiredLeads, anonymizeOldLeadIpAddresses } from '../storage/leads.js';
import { getAnalyticsRetention } from '../storage/settings.js';
import { crossOrganizationScope } from '../storage/scope.js';
import { createLogger } from '../utils/logger.js';
import { createIntervalJob } from './interval-job.js';

const log = createLogger('analytics-cleanup');

/**
 * Run the analytics cleanup job.
 *
 * With no overrides it reads the retention policy from instance settings. An
 * explicit value (used by tests) wins over the settings value for that field.
 * @param {Object} [overrides]
 * @param {number} [overrides.retentionDays] - Days to retain raw session data
 * @param {number} [overrides.ipAnonymizationDays] - Days before IP anonymization
 * @returns {Promise<{deletedSessions: number, deletedSlideViews: number, anonymizedIps: number, anonymizedLeads: number, anonymizedLeadIps: number}>}
 */
async function runAnalyticsCleanup(overrides = {}) {
  const retention = await getAnalyticsRetention(
    crossOrganizationScope(null, 'analytics retention job: instance-wide cleanup')
  );
  const retentionDays = overrides.retentionDays ?? retention.sessionDataDays;
  const ipAnonymizationDays = overrides.ipAnonymizationDays ?? retention.ipAnonymizationDays;

  // Calculate cutoff dates
  const deletionCutoff = new Date();
  deletionCutoff.setDate(deletionCutoff.getDate() - retentionDays);
  const deletionDate = deletionCutoff.toISOString();

  const ipCutoff = new Date();
  ipCutoff.setDate(ipCutoff.getDate() - ipAnonymizationDays);
  const ipAnonymizationDate = ipCutoff.toISOString();

  log.info(`Starting cleanup`);
  log.info(`- Deleting data older than ${deletionDate}`);
  log.info(`- Anonymizing IPs older than ${ipAnonymizationDate}`);

  // Anonymize IP addresses first (for data we're keeping but need to anonymize)
  const ipResult = await anonymizeOldIpAddresses(ipAnonymizationDate);
  log.info(`Anonymized ${ipResult.anonymized} IP addresses`);

  // Delete old slide views first (they reference view_sessions)
  const slideViewsResult = await deleteOldSlideViews(deletionDate);
  log.info(`Deleted ${slideViewsResult.deleted} slide views`);

  // Delete old view sessions
  const sessionsResult = await deleteOldViewSessions(deletionDate);
  log.info(`Deleted ${sessionsResult.deleted} view sessions`);

  // Anonymize expired leads (based on per-lead retention_expires_at)
  const leadsResult = await anonymizeExpiredLeads();
  log.info(`Anonymized ${leadsResult.anonymized} expired leads`);

  // Anonymize old lead IP addresses (same policy as view sessions)
  const leadIpsResult = await anonymizeOldLeadIpAddresses(ipAnonymizationDate);
  log.info(`Anonymized ${leadIpsResult.anonymized} lead IP addresses`);

  log.info(`Cleanup complete`);

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
 *
 * The retention policy is not captured here: each run reads it fresh from
 * settings, so an admin change applies on the next pass.
 * @param {Object} [options]
 * @param {number} [options.intervalMs] - Run interval (default: 24 hours)
 * @returns {Object} Job control object with stop method
 */
export function scheduleAnalyticsCleanup({
  intervalMs = 24 * 60 * 60 * 1000, // 24 hours
} = {}) {
  let isRunning = false;

  async function runJob() {
    if (isRunning) {
      log.info('Job already running, skipping');
      return;
    }

    isRunning = true;
    try {
      await runAnalyticsCleanup();
    } catch (err) {
      log.error('Job failed:', err.message);
    } finally {
      isRunning = false;
    }
  }

  // Run immediately on start, then every intervalMs.
  return createIntervalJob(runJob, { intervalMs, immediate: true });
}

// CLI support: run directly with `node analytics-cleanup.js`
if (process.argv[1]?.endsWith('analytics-cleanup.js')) {
  // No args: retention comes from instance settings (env-seeded defaults).
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