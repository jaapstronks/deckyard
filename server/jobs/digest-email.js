/**
 * Weekly Digest Email Job
 * Sends AI-generated weekly engagement summaries to users.
 *
 * Runs daily and checks if it's each user's preferred day for receiving digests.
 * Default: Monday (dayOfWeek: 1)
 */

import {
  getWeeklyAnalyticsForUser,
  getTeamWeeklyAnalytics,
  getUsersWithDigestDay,
} from '../storage/analytics/weekly-summary.js';
import {
  generateDigestWithAI,
  generateTeamDigestWithAI,
} from '../services/digest-generation.js';
import { sendWeeklyDigestEmail, sendTeamDigestEmail } from '../integrations/brevo.js';
import { readAppSettings } from '../storage/settings.js';

// ============================================================
// JOB RUNNER
// ============================================================

/**
 * Run the weekly digest job for a specific day of the week.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for settings
 * @param {number} [options.dayOfWeek] - Override day of week (0-6, 0=Sunday)
 * @returns {Promise<{sent: number, skipped: number, errors: number}>}
 */
export async function runDigestEmailJob({ repoRoot = null, dayOfWeek = null } = {}) {
  const today = dayOfWeek ?? new Date().getDay();
  const results = { sent: 0, skipped: 0, errors: 0 };

  console.log(`[digest-email] Starting digest job for day ${today}`);

  // Check if analytics is enabled globally
  if (repoRoot) {
    try {
      const appSettings = await readAppSettings(repoRoot);
      if (!appSettings.analytics?.enabled) {
        console.log('[digest-email] Analytics disabled, skipping digest job');
        return results;
      }
    } catch {
      // Continue if settings can't be read
    }
  }

  // Get users who should receive digest today
  let users;
  try {
    users = await getUsersWithDigestDay(today);
    console.log(`[digest-email] Found ${users.length} users with digest scheduled for today`);
  } catch (err) {
    console.error('[digest-email] Failed to get users:', err.message);
    return results;
  }

  // Process each user
  for (const user of users) {
    try {
      const sent = await processUserDigest(user, repoRoot);
      if (sent) {
        results.sent++;
      } else {
        results.skipped++;
      }
    } catch (err) {
      console.error(`[digest-email] Error processing digest for ${user.email}:`, err.message);
      results.errors++;
    }
  }

  // Process admin team digests
  const admins = users.filter((u) => u.role === 'admin');
  for (const admin of admins) {
    try {
      const sent = await processTeamDigest(admin, repoRoot);
      if (sent) {
        results.sent++;
      } else {
        results.skipped++;
      }
    } catch (err) {
      console.error(`[digest-email] Error processing team digest for ${admin.email}:`, err.message);
      results.errors++;
    }
  }

  console.log(`[digest-email] Completed: ${results.sent} sent, ${results.skipped} skipped, ${results.errors} errors`);
  return results;
}

/**
 * Process and send individual user digest.
 * @param {Object} user - User object
 * @param {string} repoRoot - Repository root
 * @returns {Promise<boolean>} True if email was sent
 */
async function processUserDigest(user, repoRoot) {
  console.log(`[digest-email] Processing digest for ${user.email}`);

  // Get weekly analytics
  const analytics = await getWeeklyAnalyticsForUser(
    user.id,
    user.email,
    { includeTeamAnalytics: user.includeTeamAnalytics }
  );

  // Skip if no activity and no presentations
  if (!analytics.hasActivity && analytics.presentationCount === 0) {
    console.log(`[digest-email] Skipping ${user.email}: no activity and no presentations`);
    return false;
  }

  // Generate digest content
  const digest = await generateDigestWithAI(
    { email: user.email, name: analytics.userName },
    analytics
  );

  // Send email
  const result = await sendWeeklyDigestEmail({
    recipientEmail: user.email,
    recipientName: analytics.userName,
    digest,
    dashboardUrl: buildDashboardUrl(repoRoot),
    preferencesUrl: buildPreferencesUrl(repoRoot),
    repoRoot,
  });

  if (!result.ok) {
    throw new Error(result.error || 'Failed to send email');
  }

  console.log(`[digest-email] Sent digest to ${user.email}`);
  return true;
}

/**
 * Process and send admin team digest.
 * @param {Object} admin - Admin user object
 * @param {string} repoRoot - Repository root
 * @returns {Promise<boolean>} True if email was sent
 */
async function processTeamDigest(admin, repoRoot) {
  if (!admin.organizationId) {
    console.log(`[digest-email] Skipping team digest for ${admin.email}: no organization`);
    return false;
  }

  console.log(`[digest-email] Processing team digest for ${admin.email}`);

  // Get team-wide analytics
  const teamAnalytics = await getTeamWeeklyAnalytics(admin.organizationId);

  // Skip if no team activity
  if (!teamAnalytics.hasActivity) {
    console.log(`[digest-email] Skipping team digest for ${admin.email}: no team activity`);
    return false;
  }

  // Generate team digest content
  const digest = await generateTeamDigestWithAI(
    { email: admin.email, name: admin.email.split('@')[0] },
    teamAnalytics
  );

  // Send email
  const result = await sendTeamDigestEmail({
    recipientEmail: admin.email,
    recipientName: admin.email.split('@')[0],
    digest,
    dashboardUrl: buildDashboardUrl(repoRoot),
    preferencesUrl: buildPreferencesUrl(repoRoot),
    repoRoot,
  });

  if (!result.ok) {
    throw new Error(result.error || 'Failed to send team email');
  }

  console.log(`[digest-email] Sent team digest to ${admin.email}`);
  return true;
}

// ============================================================
// URL BUILDERS
// ============================================================

function buildDashboardUrl(repoRoot) {
  // Use APP_URL from environment or fallback
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  return `${baseUrl}/insights`;
}

function buildPreferencesUrl(repoRoot) {
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  return `${baseUrl}/settings#preferences`;
}

// ============================================================
// SCHEDULED JOB
// ============================================================

/**
 * Schedule the digest email job to run daily.
 * @param {Object} options
 * @param {string} [options.repoRoot] - Repository root for settings
 * @param {number} [options.intervalMs] - Run interval (default: 24 hours)
 * @param {number} [options.runAtHour] - Hour of day to run (0-23, default: 8 = 8 AM)
 * @returns {Object} Job control object with stop method
 */
export function scheduleDigestEmailJob({
  repoRoot = null,
  intervalMs = 24 * 60 * 60 * 1000, // 24 hours
  runAtHour = 8, // 8 AM
} = {}) {
  let intervalId = null;
  let timeoutId = null;
  let isRunning = false;

  async function runJob() {
    if (isRunning) {
      console.log('[digest-email] Job already running, skipping');
      return;
    }

    isRunning = true;
    try {
      await runDigestEmailJob({ repoRoot });
    } catch (err) {
      console.error('[digest-email] Job failed:', err.message);
    } finally {
      isRunning = false;
    }
  }

  // Calculate delay until next run time (at runAtHour)
  function getDelayUntilRunTime() {
    const now = new Date();
    const runTime = new Date(now);
    runTime.setHours(runAtHour, 0, 0, 0);

    // If we've passed the run time today, schedule for tomorrow
    if (now > runTime) {
      runTime.setDate(runTime.getDate() + 1);
    }

    return runTime.getTime() - now.getTime();
  }

  // Schedule first run
  const initialDelay = getDelayUntilRunTime();
  console.log(`[digest-email] Scheduling first run in ${Math.round(initialDelay / 1000 / 60)} minutes`);

  timeoutId = setTimeout(() => {
    runJob();
    // Then run every 24 hours
    intervalId = setInterval(runJob, intervalMs);
    intervalId.unref?.();
  }, initialDelay);

  timeoutId.unref?.();

  return {
    stop() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },

    // For testing: run immediately
    async runNow() {
      return runJob();
    },
  };
}

// CLI support: run directly with `node digest-email.js`
if (process.argv[1]?.endsWith('digest-email.js')) {
  const dayArg = process.argv[2];
  const dayOfWeek = dayArg ? parseInt(dayArg, 10) : undefined;

  runDigestEmailJob({ dayOfWeek })
    .then((result) => {
      console.log(`Digest job completed: ${result.sent} sent, ${result.skipped} skipped, ${result.errors} errors`);
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Digest job failed:', err);
      process.exit(1);
    });
}
