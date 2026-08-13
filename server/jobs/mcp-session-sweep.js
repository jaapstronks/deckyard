/**
 * Periodic sweep for expired MCP SSE sessions.
 *
 * The session registry lives in `server/mcp/sse.js`; this job only owns the
 * schedule, per the jobs convention: recurring work is scheduled from
 * `server.js` through a `schedule…() → { stop() }` handle, never from a
 * module-load timer.
 */

import { sweepExpiredMcpSessions } from '../mcp/sse.js';

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Schedule the MCP session sweep.
 * @returns {{ stop: () => void }} Job handle.
 */
export function scheduleMcpSessionSweep() {
  const t = setInterval(sweepExpiredMcpSessions, SWEEP_INTERVAL_MS);
  t.unref?.(); // Don't keep process alive just for this
  return {
    stop() {
      try {
        clearInterval(t);
      } catch {
        // ignore
      }
    },
  };
}
