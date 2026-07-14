/**
 * Authentication cleanup job.
 * Cleans up expired magic link tokens, password reset tokens, and old audit logs.
 *
 * Default schedules:
 * - Expired tokens: cleaned up immediately (they're past expiration)
 * - Audit logs: retained for 90 days
 */

import { cleanupExpiredTokens as cleanupMagicLinkTokens } from '../storage/magic-link.js';
import {
  cleanupExpiredTokens as cleanupPasswordResetTokens,
  cleanupOldAuditLogs,
} from '../storage/password-reset.js';

// ============================================================
// CONFIGURATION
// ============================================================

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ============================================================
// CLEANUP FUNCTIONS
// ============================================================

/**
 * Run the auth cleanup job.
 * Cleans up expired tokens from both magic link and password reset tables,
 * and removes old audit log entries.
 *
 * @returns {Promise<{magicLinkTokens: number, passwordResetTokens: number, auditLogs: number}>}
 */
export async function runAuthCleanup() {
  console.log('[auth-cleanup] Starting cleanup');

  // Clean up expired magic link tokens
  const magicLinkTokens = await cleanupMagicLinkTokens();
  console.log(`[auth-cleanup] Deleted ${magicLinkTokens} expired magic link tokens`);

  // Clean up expired password reset tokens
  const passwordResetTokens = await cleanupPasswordResetTokens();
  console.log(`[auth-cleanup] Deleted ${passwordResetTokens} expired password reset tokens`);

  // Clean up old audit logs (90+ days)
  const auditLogs = await cleanupOldAuditLogs();
  console.log(`[auth-cleanup] Deleted ${auditLogs} old audit log entries`);

  console.log('[auth-cleanup] Cleanup complete');

  return {
    magicLinkTokens,
    passwordResetTokens,
    auditLogs,
  };
}

/**
 * Schedule the auth cleanup job to run periodically.
 *
 * @param {Object} [options]
 * @param {number} [options.intervalMs] - Run interval in milliseconds (default: 1 hour)
 * @returns {Object} Job control object with stop method
 */
export function scheduleAuthCleanup({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let intervalId = null;
  let isRunning = false;

  async function runJob() {
    if (isRunning) {
      console.log('[auth-cleanup] Job already running, skipping');
      return;
    }

    isRunning = true;
    try {
      await runAuthCleanup();
    } catch (err) {
      console.error('[auth-cleanup] Job failed:', err.message);
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

// Run directly with `node auth-cleanup.js`
if (process.argv[1]?.endsWith('auth-cleanup.js')) {
  runAuthCleanup()
    .then((result) => {
      console.log(`\nSummary:`);
      console.log(`  Magic link tokens deleted: ${result.magicLinkTokens}`);
      console.log(`  Password reset tokens deleted: ${result.passwordResetTokens}`);
      console.log(`  Audit log entries deleted: ${result.auditLogs}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Cleanup failed:', err);
      process.exit(1);
    });
}