/**
 * Periodic sweep for expired MCP SSE sessions.
 *
 * The session registry lives in `server/mcp/sse.js`; this job only owns the
 * schedule, per the jobs convention: recurring work is scheduled from
 * `server.js` through a `schedule…() → { stop() }` handle, never from a
 * module-load timer.
 */

import { sweepExpiredMcpSessions } from '../mcp/sse.js';
import { countActiveApiKeys } from '../storage/api-keys.js';
import { crossOrganizationScope } from '../storage/scope.js';
import { createLogger } from '../utils/logger.js';
import { createIntervalJob } from './interval-job.js';

const log = createLogger('mcp-session-sweep');

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

/**
 * The one boot line for a public API cluster that is off while unrevoked keys
 * are still stored (D261): every key surface answers 404 now, nothing is
 * revoked, and switching the cluster back on makes the keys work again. The
 * session sweep above keeps running either way.
 * @returns {Promise<void>}
 */
export async function warnApiKeysWhileOff() {
  const keys = await countActiveApiKeys(
    crossOrganizationScope(null, 'public API boot line: instance-wide count'),
  );
  if (keys === 0) return;
  log.warn(
    `PUBLIC_API_ENABLED=false, but ${keys} unrevoked API key(s) are still ` +
      `stored. They are refused while the public API is off; nothing is revoked.`,
  );
}
