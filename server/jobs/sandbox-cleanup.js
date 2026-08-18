import { getDb } from '../db/client.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { sandboxEnabled, sandboxTtlMs } from '../config/sandbox.js';
import {
  getSandboxTotalBytes,
  sandboxMaxTotalBytes,
} from '../storage/presentations/sandbox-quota.js';
import { createLogger } from '../utils/logger.js';
import { createIntervalJob } from './interval-job.js';

const log = createLogger('sandbox-cleanup');

/**
 * Hard-delete every expired ephemeral sandbox deck from Postgres, once.
 *
 * Sandbox runs on Postgres, so the sweep is a single bulk `DELETE` against the
 * `presentations` table rather than the old directory scan. A deck is ephemeral
 * when its visibility is not `organization` (mirroring `isSandboxEphemeralPresentation`
 * — organization-visible decks are curated seed decks that never expire), and
 * expired once it is older than the TTL. Foreign keys cascade, so the delete
 * also removes the deck's version snapshots, published entry, and cold Y.Doc
 * state in one statement — much cheaper than the per-file cleanup it replaces.
 *
 * @returns {Promise<number>} How many decks were deleted.
 */
export async function sweepExpiredSandboxDecks() {
  const db = getDb();
  const orgId = getDefaultOrganizationId();
  // Expired = created before (now − TTL). sandboxTtlMs() stays the single
  // source of the TTL value; only the comparison lives in SQL.
  const cutoff = new Date(Date.now() - sandboxTtlMs()).toISOString();

  const result = await db
    .deleteFrom('presentations')
    .where('organization_id', '=', orgId)
    .where('visibility', '<>', 'organization')
    .where('created_at', '<=', cutoff)
    .executeTakeFirst();

  const deleted = Number(result?.numDeletedRows ?? 0);

  // Non-destructive disk-usage guard: once TTL-expired decks are gone, warn if
  // the whole presentations table is still over the global soft ceiling.
  // Per-guest quotas (sandbox-quota.js) are the real cap on growth; this is
  // observability so an operator notices before the volume is full. We do NOT
  // evict non-expired decks here — that would delete live guest work.
  const ceiling = sandboxMaxTotalBytes();
  if (ceiling > 0) {
    const total = await getSandboxTotalBytes({ organizationId: orgId });
    if (total >= ceiling) {
      log.warn(
        `sandbox presentations at ${total} bytes ≥ ceiling ${ceiling}; ` +
          'consider lowering SANDBOX_TTL_HOURS or the per-guest quota.'
      );
    }
  }

  return deleted;
}

/**
 * Schedule the periodic sandbox TTL sweep. No-op (returns an inert handle)
 * outside sandbox mode, so non-sandbox deploys never touch the database here.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs] - Sweep interval (min 30s).
 * @returns {{ stop: () => void }} Job handle.
 */
export function scheduleSandboxCleanup({ intervalMs = 10 * 60 * 1000 } = {}) {
  if (!sandboxEnabled()) return { stop() {} };

  let stopped = false;
  let running = false;

  async function sweep() {
    if (stopped || running) return;
    running = true;
    try {
      const deleted = await sweepExpiredSandboxDecks();
      if (deleted > 0) log.info(`swept ${deleted} expired sandbox deck(s)`);
    } catch (err) {
      // Best-effort: a sweep that fails (DB blip) simply retries next interval.
      log.warn(`sandbox sweep failed: ${err?.message || err}`);
    } finally {
      running = false;
    }
  }

  // Run immediately, then on interval — the first synchronous sweep collects
  // what a crash left behind. The floor guards against a mistyped interval.
  const handle = createIntervalJob(sweep, {
    intervalMs: Math.max(30_000, Number(intervalMs) || 10 * 60 * 1000),
    immediate: true,
  });
  return {
    stop() {
      stopped = true; // Also short-circuit a sweep already past its guard.
      handle.stop();
    },
  };
}
