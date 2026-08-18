/**
 * Periodic sweep for expired MCP SSE sessions.
 *
 * The session registry lives in `server/mcp/sse.js`; this job only owns the
 * schedule, per the jobs convention: recurring work is scheduled from
 * `server.js` through a `schedule…() → { stop() }` handle, never from a
 * module-load timer.
 */

import { sweepExpiredMcpSessions } from '../mcp/sse.js';
import { createIntervalJob } from './interval-job.js';

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Schedule the MCP session sweep. No immediate first run: the registry starts
 * empty, so the first sweep worth doing is a full interval away.
 * @returns {{ stop: () => void }} Job handle.
 */
export function scheduleMcpSessionSweep() {
  return createIntervalJob(sweepExpiredMcpSessions, {
    intervalMs: SWEEP_INTERVAL_MS,
  });
}
