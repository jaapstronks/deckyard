/**
 * AI Logging Utility
 *
 * Logs LLM conversations for debugging and finetuning.
 * Logs are written to server/logs/ai/ directory with timestamps.
 *
 * NOTE: Logging is disabled in production (NODE_ENV=production) to avoid
 * filling up disk space on the VPS.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from '../normalize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log directory - relative to server root
const LOG_DIR = path.resolve(__dirname, '../../logs/ai');

// Check if we're in production - skip file logging on VPS
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Ensure log directory exists
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Generate a timestamp-based filename
 */
function generateLogFilename(prefix) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${prefix}_${timestamp}.json`;
}

/**
 * Log an LLM conversation
 *
 * @param {Object} options
 * @param {string} options.phase - 'outline' | 'refine' | 'convert'
 * @param {string} options.sessionId - Unique session identifier
 * @param {Object} options.input - The input data sent to the LLM
 * @param {Object} options.messages - The messages array sent to the API
 * @param {Object} options.output - The parsed output from the LLM
 * @param {string} options.rawResponse - The raw response string
 * @param {Object} options.metadata - Additional metadata (model, timing, etc.)
 */
export function logLlmConversation({
  phase,
  sessionId,
  input,
  messages,
  output,
  rawResponse,
  metadata = {},
}) {
  // Skip file logging in production
  if (IS_PRODUCTION) {
    return null;
  }

  try {
    ensureLogDir();

    const logEntry = {
      timestamp: nowIso(),
      sessionId,
      phase,
      input,
      messages,
      output,
      rawResponse: rawResponse?.slice(0, 50000), // Limit raw response size
      metadata: {
        ...metadata,
        loggedAt: Date.now(),
      },
    };

    const filename = generateLogFilename(`${phase}_${sessionId || 'unknown'}`);
    const filepath = path.join(LOG_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(logEntry, null, 2), 'utf8');

    console.log(`[AI Log] Saved: ${filename}`);
    return filepath;
  } catch (err) {
    console.error('[AI Log] Failed to write log:', err.message);
    return null;
  }
}

/**
 * Log a complete deck generation session
 *
 * @param {Object} options
 * @param {string} options.sessionId
 * @param {Object} options.phase1 - Phase 1 (outline) log data
 * @param {Array} options.phase2Calls - Array of Phase 2 (refine) log data
 * @param {Object} options.finalDeck - The final generated deck
 * @param {Object} options.metadata
 */
export function logDeckGenerationSession({
  sessionId,
  phase1,
  phase2Calls,
  finalDeck,
  metadata = {},
}) {
  // Skip file logging in production
  if (IS_PRODUCTION) {
    return null;
  }

  try {
    ensureLogDir();

    const logEntry = {
      timestamp: nowIso(),
      sessionId,
      type: 'full-session',
      phase1,
      phase2Calls,
      finalDeck,
      summary: {
        totalSlides: finalDeck?.slides?.length || 0,
        slideTypes: countSlideTypes(finalDeck?.slides),
        phase2CallCount: phase2Calls?.length || 0,
      },
      metadata: {
        ...metadata,
        loggedAt: Date.now(),
      },
    };

    const filename = generateLogFilename(`session_${sessionId || 'unknown'}`);
    const filepath = path.join(LOG_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(logEntry, null, 2), 'utf8');

    console.log(`[AI Log] Session saved: ${filename}`);
    return filepath;
  } catch (err) {
    console.error('[AI Log] Failed to write session log:', err.message);
    return null;
  }
}

/**
 * Count slide types in a deck
 */
function countSlideTypes(slides) {
  if (!Array.isArray(slides)) return {};
  const counts = {};
  for (const slide of slides) {
    const type = slide?.type || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

/**
 * Create a logger instance for a specific session
 */
export function createSessionLogger(sessionId) {
  const logs = {
    phase1: null,
    phase2Calls: [],
  };

  return {
    sessionId,

    logPhase1(data) {
      logs.phase1 = {
        ...data,
        timestamp: nowIso(),
      };
      logLlmConversation({
        phase: 'outline',
        sessionId,
        ...data,
      });
    },

    logPhase2Call(data) {
      const callLog = {
        ...data,
        timestamp: nowIso(),
        callIndex: logs.phase2Calls.length,
      };
      logs.phase2Calls.push(callLog);
      logLlmConversation({
        phase: 'refine',
        sessionId,
        ...data,
      });
    },

    finalize(finalDeck, metadata = {}) {
      return logDeckGenerationSession({
        sessionId,
        phase1: logs.phase1,
        phase2Calls: logs.phase2Calls,
        finalDeck,
        metadata,
      });
    },

    getLogs() {
      return { ...logs };
    },
  };
}

/**
 * Generate a unique session ID
 */
export function generateSessionId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}