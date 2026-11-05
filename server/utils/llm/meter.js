/**
 * The AI call meter (DY-844): every model call is counted where it leaves the
 * process, and refused once the installation's daily ceiling is reached.
 *
 * It sits on the transport (`requestChatCompletionContent`), so a new AI path
 * is metered without knowing it exists. The transport does not know who asked;
 * the entry point that does says so once with {@link runWithAiAttribution}
 * around the work it dispatches (internal API, v1, MCP `tools/call`, the
 * translate worker, the digest job). The attribution travels with the async
 * context, through streams and awaited helpers, to every call made inside it.
 *
 * The unit is the model call, not the token: a call is known before it goes
 * out, so the ceiling can refuse it, and every vendor makes one, while token
 * counts arrive afterwards and not from every vendor. Tokens are recorded next
 * to the calls where the vendor reports them (`usage.js`).
 *
 * Metering never breaks the call it counts: without a database, or when a
 * write fails, the call goes out (or its answer comes back) and the failure is
 * logged. The one refusal is
 * the ceiling, an {@link AiQuotaError} (429, `ai_quota_exceeded`).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../errors.js';
import { envInt } from '../../config/utils.js';
import { createLogger } from '../logger.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import {
  recordOrganizationAiUsage,
  reserveInstanceAiCall,
  usageDay,
} from '../../storage/ai-usage.js';
import { subscribeLlmUsage } from './usage.js';

const log = createLogger('ai-meter');

/** The storage scope the model calls in this async context are made for. */
const attribution = new AsyncLocalStorage();

/** The token counts of the one call in flight in this async context. */
const callInFlight = new AsyncLocalStorage();

subscribeLlmUsage((event) => {
  const call = callInFlight.getStore();
  if (!call) return;
  call.inputTokens += event.inputTokens || 0;
  call.outputTokens += event.outputTokens || 0;
  call.cacheReadTokens += event.cacheReadTokens || 0;
  call.cacheWriteTokens += event.cacheWriteTokens || 0;
});

/**
 * The installation's daily ceiling on model calls, `AI_DAILY_CALL_LIMIT`.
 * Unset or 0: no ceiling, calls are still counted.
 * @returns {number}
 */
export function aiDailyCallLimit() {
  return envInt('AI_DAILY_CALL_LIMIT', 0, { min: 0 });
}

/** Seconds until the next UTC day, when the counter starts again. */
function secondsUntilNextDay(now = new Date()) {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/** The installation has spent its model calls for today. */
export class AiQuotaError extends AppError {
  /**
   * @param {{ limit: number, used: number, retryAfter: number }} details
   *   The registered payload for `ai_quota_exceeded`.
   */
  constructor(details) {
    super(
      'This installation has used its AI calls for today. Try again tomorrow.',
      429,
      details,
      'ai_quota_exceeded',
    );
    this.retryAfter = details.retryAfter;
  }
}

/**
 * Run `fn` with every model call inside it counted for `scope`'s organization
 * and actor.
 *
 * @template T
 * @param {{ organizationId?: string|null, actorEmail?: string|null, repoRoot?: string|null }|null|undefined} scope
 *   The entry point's storage scope. A scope without an organization counts
 *   on the instance total only.
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithAiAttribution(scope, fn) {
  return attribution.run(scope?.organizationId ? scope : null, fn);
}

/**
 * Count one model call: reserve it against the ceiling, run it, record it and
 * its tokens for the attributed organization. A call that fails upstream still
 * counts; the vendor may have billed it.
 *
 * @template T
 * @param {() => Promise<T>} run - The provider call.
 * @returns {Promise<T>}
 */
export async function meterLlmCall(run) {
  const who = attribution.getStore() || null;
  const now = new Date();
  const day = usageDay(now);
  const limit = aiDailyCallLimit();

  const reservation = await reserveInstanceAiCall(
    crossOrganizationScope(who?.repoRoot ?? null, 'instance AI call ceiling'),
    { day, limit },
  ).catch((err) => {
    log.warn('reserving an AI call failed:', err?.message);
    return { ok: false, reason: 'unavailable' };
  });
  if (!reservation.ok && reservation.reason === 'rate_limited') {
    throw new AiQuotaError({
      limit,
      used: reservation.used,
      retryAfter: secondsUntilNextDay(now),
    });
  }

  const call = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  try {
    return await callInFlight.run(call, run);
  } finally {
    if (who) {
      await recordOrganizationAiUsage(who, { day, calls: 1, ...call }).catch(
        (err) => log.warn('recording an AI call failed:', err?.message),
      );
    } else {
      log.debug('AI call without attribution: counted on the instance only');
    }
  }
}
