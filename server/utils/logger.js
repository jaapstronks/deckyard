/**
 * Standardized logging utility with consistent formatting.
 *
 * Usage:
 *   import { createLogger } from './logger.js';
 *   const log = createLogger('module-name');
 *   log.info('Something happened');
 *   log.error('Something failed:', err);
 *   log.warn('Something suspicious');
 *   log.debug('Detailed info'); // Only when DEBUG_LOG=true
 */

import { isDebugLogEnabled } from './debug-log.js';

/**
 * Format a log message with timestamp and module prefix.
 * @param {string} level - Log level (info, warn, error, debug)
 * @param {string} module - Module name
 * @returns {string} Formatted prefix
 */
function formatPrefix(level, module) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] [${module}]`;
}

/**
 * Create a logger instance for a specific module.
 *
 * @param {string} moduleName - Name of the module (e.g., 'admin-users', 'auth')
 * @returns {Object} Logger instance with info, warn, error, debug methods
 *
 * @example
 * const log = createLogger('collaborators');
 * log.info('User added to presentation', { userId, presentationId });
 * log.error('Failed to add user:', err);
 */
export function createLogger(moduleName) {
  return {
    /**
     * Log informational message.
     * @param {...any} args - Message and optional data
     */
    info(...args) {
      console.log(formatPrefix('info', moduleName), ...args);
    },

    /**
     * Log warning message.
     * @param {...any} args - Message and optional data
     */
    warn(...args) {
      console.warn(formatPrefix('warn', moduleName), ...args);
    },

    /**
     * Log error message.
     * @param {...any} args - Message and optional error
     */
    error(...args) {
      console.error(formatPrefix('error', moduleName), ...args);
    },

    /**
     * Log debug message (only when DEBUG_LOG=true).
     * @param {...any} args - Message and optional data
     */
    debug(...args) {
      if (isDebugLogEnabled()) {
        console.log(formatPrefix('debug', moduleName), ...args);
      }
    },
  };
}

/**
 * Simple log function with module prefix (legacy compatibility).
 * Use createLogger() for new code.
 *
 * @param {string} module - Module name in brackets
 * @param {...any} args - Message arguments
 */
export function logError(module, ...args) {
  console.error(`[${module}]`, ...args);
}

/**
 * Simple warning log with module prefix.
 * @param {string} module - Module name
 * @param {...any} args - Message arguments
 */
export function logWarn(module, ...args) {
  console.warn(`[${module}]`, ...args);
}

/**
 * Simple info log with module prefix.
 * @param {string} module - Module name
 * @param {...any} args - Message arguments
 */
export function logInfo(module, ...args) {
  console.log(`[${module}]`, ...args);
}

/**
 * Simple debug log with module prefix (only when DEBUG_LOG=true).
 * @param {string} module - Module name
 * @param {...any} args - Message arguments
 */
export function logDebug(module, ...args) {
  if (isDebugLogEnabled()) {
    console.log(`[${module}]`, ...args);
  }
}