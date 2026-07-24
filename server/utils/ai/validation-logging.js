/**
 * AI Validation Logging
 *
 * Persists validation events (unknown fields, schema issues, etc.) to disk.
 * Unlike LLM conversation logs, these are kept small and enabled in production
 * to help improve AI prompts over time.
 *
 * Logs are rotated daily and kept for 30 days.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from '../normalize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log directory - relative to server root
const LOG_DIR = path.resolve(__dirname, '../../logs/ai-validation');

// Enable/disable via environment variable (default: enabled)
const ENABLED = process.env.AI_VALIDATION_LOGGING !== 'false';

// How long to keep log files (in days)
const LOG_RETENTION_DAYS = 30;

// In-memory buffer for current day's entries
let currentBuffer = [];
let currentDate = null;
let writeScheduled = false;

/**
 * Get the log filename for a given date
 */
function getLogFilename(date = new Date()) {
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return `validation_${dateStr}.jsonl`;
}

/**
 * Ensure log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Flush the current buffer to disk
 */
function flushBuffer() {
  if (!ENABLED || currentBuffer.length === 0) {
    writeScheduled = false;
    return;
  }

  try {
    ensureLogDir();
    const filename = getLogFilename();
    const filepath = path.join(LOG_DIR, filename);

    // Append entries as JSON lines
    const lines = currentBuffer.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    fs.appendFileSync(filepath, lines, 'utf8');

    currentBuffer = [];
  } catch (err) {
    console.error('[AI Validation Log] Failed to flush buffer:', err.message);
  }

  writeScheduled = false;
}

/**
 * Schedule a buffer flush (debounced)
 */
function scheduleFlush() {
  if (writeScheduled) return;
  writeScheduled = true;
  // Flush after 1 second of inactivity, or immediately if buffer is large
  const delay = currentBuffer.length > 100 ? 0 : 1000;
  setTimeout(flushBuffer, delay);
}

/**
 * Log a validation event
 *
 * @param {string} event - Event type (e.g., 'unknown-fields', 'zod-validation-issues')
 * @param {Object} details - Event details
 */
export function logValidationEvent(event, details = {}) {
  if (!ENABLED) return;

  // Check if we've crossed into a new day
  const today = new Date().toISOString().slice(0, 10);
  if (currentDate !== today) {
    flushBuffer(); // Flush previous day's entries
    currentDate = today;
  }

  const entry = {
    timestamp: nowIso(),
    event,
    ...details,
  };

  currentBuffer.push(entry);
  scheduleFlush();

  // Also log to console for immediate visibility
  const level =
    event.includes('error') || event.includes('fail')
      ? 'error'
      : event.includes('warn') || event.includes('unknown')
        ? 'warn'
        : 'log';
  console[level](`[AI Validation] ${event}:`, JSON.stringify(details, null, 2));
}

/**
 * Get validation logs for a date range
 *
 * @param {Object} options
 * @param {string} options.startDate - Start date (YYYY-MM-DD), defaults to 7 days ago
 * @param {string} options.endDate - End date (YYYY-MM-DD), defaults to today
 * @param {string} options.eventType - Filter by event type (optional)
 * @param {number} options.limit - Maximum entries to return (default 1000)
 * @returns {Array} Array of log entries
 */
export function getValidationLogs({
  startDate,
  endDate,
  eventType,
  limit = 1000,
} = {}) {
  ensureLogDir();

  // Default to last 7 days
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate
    ? new Date(startDate)
    : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

  const entries = [];
  const current = new Date(start);

  // Iterate through dates
  while (current <= end && entries.length < limit) {
    const filename = getLogFilename(current);
    const filepath = path.join(LOG_DIR, filename);

    if (fs.existsSync(filepath)) {
      try {
        const content = fs.readFileSync(filepath, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);

        for (const line of lines) {
          if (entries.length >= limit) break;

          try {
            const entry = JSON.parse(line);
            if (!eventType || entry.event === eventType) {
              entries.push(entry);
            }
          } catch {
            // Skip malformed lines
          }
        }
      } catch (err) {
        console.error(`[AI Validation Log] Failed to read ${filename}:`, err.message);
      }
    }

    current.setDate(current.getDate() + 1);
  }

  // Also include any buffered entries not yet flushed
  for (const entry of currentBuffer) {
    if (entries.length >= limit) break;
    if (!eventType || entry.event === eventType) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Get a summary of validation events
 *
 * @param {Object} options - Same as getValidationLogs
 * @returns {Object} Summary statistics
 */
export function getValidationSummary(options = {}) {
  const logs = getValidationLogs({ ...options, limit: 100000 });

  const summary = {
    totalEvents: logs.length,
    byEventType: {},
    bySlideType: {},
    unknownFieldsFrequency: {},
    dateRange: {
      start: logs.length ? logs[0].timestamp : null,
      end: logs.length ? logs[logs.length - 1].timestamp : null,
    },
  };

  for (const entry of logs) {
    // Count by event type
    const event = entry.event || 'unknown';
    summary.byEventType[event] = (summary.byEventType[event] || 0) + 1;

    // Count by slide type
    if (entry.slideType) {
      summary.bySlideType[entry.slideType] = (summary.bySlideType[entry.slideType] || 0) + 1;
    }

    // Track unknown fields frequency
    if (entry.event === 'unknown-fields' && Array.isArray(entry.unknownFields)) {
      for (const field of entry.unknownFields) {
        const key = `${entry.slideType || 'unknown'}.${field}`;
        summary.unknownFieldsFrequency[key] = (summary.unknownFieldsFrequency[key] || 0) + 1;
      }
    }
  }

  // Sort unknown fields by frequency
  summary.topUnknownFields = Object.entries(summary.unknownFieldsFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([field, count]) => ({ field, count }));

  return summary;
}

/**
 * List available log files
 *
 * @returns {Array} Array of { filename, date, size, entries }
 */
export function listLogFiles() {
  ensureLogDir();

  const files = fs.readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('validation_') && f.endsWith('.jsonl'))
    .sort()
    .reverse(); // Most recent first

  return files.map((filename) => {
    const filepath = path.join(LOG_DIR, filename);
    const stats = fs.statSync(filepath);
    const dateMatch = filename.match(/validation_(\d{4}-\d{2}-\d{2})\.jsonl/);

    // Count entries
    let entries = 0;
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      entries = content.trim().split('\n').filter(Boolean).length;
    } catch {
      // ignore
    }

    return {
      filename,
      date: dateMatch ? dateMatch[1] : null,
      size: stats.size,
      entries,
      modified: stats.mtime.toISOString(),
    };
  });
}

/**
 * Clean up old log files
 */
export function cleanupOldLogs() {
  ensureLogDir();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOG_RETENTION_DAYS);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const files = fs.readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('validation_') && f.endsWith('.jsonl'));

  let deleted = 0;
  for (const filename of files) {
    const dateMatch = filename.match(/validation_(\d{4}-\d{2}-\d{2})\.jsonl/);
    if (dateMatch && dateMatch[1] < cutoffStr) {
      try {
        fs.unlinkSync(path.join(LOG_DIR, filename));
        deleted++;
      } catch (err) {
        console.error(`[AI Validation Log] Failed to delete ${filename}:`, err.message);
      }
    }
  }

  if (deleted > 0) {
    console.log(`[AI Validation Log] Cleaned up ${deleted} old log files`);
  }

  return deleted;
}

/**
 * Download a specific log file's contents
 *
 * @param {string} filename - The log filename
 * @returns {string|null} File contents or null if not found
 */
export function downloadLogFile(filename) {
  // Validate filename to prevent path traversal
  if (!filename || !/^validation_\d{4}-\d{2}-\d{2}\.jsonl$/.test(filename)) {
    return null;
  }

  const filepath = path.join(LOG_DIR, filename);
  if (!fs.existsSync(filepath)) {
    return null;
  }

  return fs.readFileSync(filepath, 'utf8');
}

// Run cleanup on startup
setTimeout(() => {
  try {
    cleanupOldLogs();
  } catch (err) {
    console.error('[AI Validation Log] Cleanup failed:', err.message);
  }
}, 5000);
