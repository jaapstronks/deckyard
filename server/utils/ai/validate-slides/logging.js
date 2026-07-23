/**
 * Validation logging.
 *
 * Keeps a bounded in-memory ring of recent validation events for quick
 * debugging access, and forwards every event to the disk-backed logger.
 */

import { logValidationEvent } from '../validation-logging.js';

// In-memory log accumulator for quick access (recent entries only)
const validationLog = [];
const MAX_IN_MEMORY_LOGS = 500;

/**
 * Log a validation event (persisted to disk and kept in memory)
 */
export function logValidation(event, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...details,
  };

  // Keep in memory for quick access (limited)
  validationLog.push(entry);
  if (validationLog.length > MAX_IN_MEMORY_LOGS) {
    validationLog.shift();
  }

  // Persist to disk via validation-logging module
  logValidationEvent(event, details);
}

/**
 * Get recent validation logs from memory (for debugging)
 */
export function getRecentValidationLogs(limit = 50) {
  return validationLog.slice(-limit);
}

/**
 * Clear in-memory validation logs
 */
export function clearValidationLogs() {
  validationLog.length = 0;
}
