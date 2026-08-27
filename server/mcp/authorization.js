/**
 * MCP authorization — the permission gate and the quota gate for tool calls.
 *
 * `/api/v1` and `/mcp` authenticate with the same `dk_live_*` API keys, so one
 * key must mean the same thing on both transports. v1 is the reference
 * implementation: a per-minute token bucket and a usage increment in the
 * dispatcher, `requirePermission(ctx, permission)` in front of every handler,
 * and a daily AI/export limit on the handlers that spend one
 * (`server/routes/public-api/v1/middleware.js`). This module is the MCP
 * spelling of exactly that, in exactly that order, applied at the `tools/call`
 * choke-point in ./protocol.js — next to the maintenance write-gate that
 * already lives there.
 *
 * The order matters, and it is v1's: the bucket and the request counter come
 * first, so a refused call is as expensive to the caller as an accepted one.
 * Gating on the permission first would make out-of-scope calls a free way to
 * keep the server busy.
 *
 * Two deliberate shapes:
 *
 * - **Fail closed on a missing permission.** A tool that declares none is
 *   refused, the same way the maintenance gate treats a tool that forgets
 *   `readOnly` as a write. A new (or fork-registered custom) tool cannot slip
 *   past the gate by omission; `tests/mcp/mcp-tool-permissions.test.js` turns
 *   that into a registry gate so core tools fail the suite, not the caller.
 * - **No key, no gate.** stdio is a locally launched process with direct
 *   database access, started by whoever owns the machine — there is no key to
 *   judge, and authorization happened at launch. The gate therefore applies
 *   exactly when the request carries an API key, i.e. on the SSE transport.
 *
 * A refusal is a JSON-RPC *tool* error (`isError`), not an HTTP status — see
 * `docs/reference/api-error-format.md` § 401 versus 403.
 */

import { TIER_LIMITS, hasPermission } from '../storage/api-keys.js';
import {
  incrementUsage,
  checkAiRateLimit,
  checkExportRateLimit,
} from '../storage/api-usage.js';
import { allowRequest } from '../utils/rate-limit.js';
import { apiTierBucket } from '../config/rate-limits.js';
import { fireAndForget } from '../utils/fire-and-forget.js';

/**
 * The API key acting on this request, or null for a keyless (stdio) call.
 * @param {Object} [context] - Per-request tool context
 * @returns {{id: string, tier: string, permissions: string[]}|null}
 */
function actingKey(context) {
  const key = context?.apiKey;
  return key && key.id ? key : null;
}

/**
 * Add to the key's daily usage, in the same counters v1 increments.
 * @param {string} apiKeyId - The acting key
 * @param {Object} counters - `{requests, aiRequests, exports}` deltas
 * @returns {Promise<Object>} The in-flight write, already fire-and-forgotten
 */
function track(apiKeyId, counters) {
  const pending = incrementUsage(apiKeyId, counters);
  fireAndForget(pending, 'mcp usage tracking');
  return pending;
}

/**
 * May this key call this tool, and is it within its quota?
 *
 * Also spends what the call costs: the per-minute bucket and the request
 * counter for every keyed call, plus the AI/export counter for a call that
 * passes the matching daily limit.
 *
 * @param {{name: string, permission?: string}} tool - The registered tool
 * @param {Object} [context] - Per-request tool context (`apiKey` when keyed)
 * @returns {Promise<{ok: boolean, message?: string, tracked: Promise<Object>|null}>}
 *   `tracked` resolves when the usage writes land — returned for tests; the
 *   dispatch ignores it, because tracking never delays a tool call.
 */
export async function enforceToolPolicy(tool, context) {
  const apiKey = actingKey(context);
  if (!apiKey) return { ok: true, tracked: null };

  const tier = apiKey.tier || 'free';
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;

  // Same bucket key as v1 (`api:<keyId>`), so switching transport does not
  // hand the same key a second per-minute allowance.
  const allowed = await allowRequest(
    `api:${apiKey.id}`,
    apiTierBucket(limits.requestsPerMinute),
  );
  if (!allowed) {
    return {
      ok: false,
      message: 'Rate limit exceeded. Please slow down your requests.',
      tracked: null,
    };
  }

  const tracked = track(apiKey.id, { requests: 1 });

  if (!tool.permission) {
    return {
      ok: false,
      message: `Tool ${tool.name} declares no required permission and cannot be called with an API key.`,
      tracked,
    };
  }

  if (!hasPermission(apiKey.permissions, tool.permission)) {
    return {
      ok: false,
      message: `API key lacks required permission: ${tool.permission}`,
      tracked,
    };
  }

  if (tool.permission === 'ai') {
    const result = await checkAiRateLimit(apiKey.id, tier);
    if (!result.ok) {
      return { ok: false, message: 'Service unavailable', tracked };
    }
    if (result.limited) {
      return {
        ok: false,
        message: `Daily AI request limit exceeded (${result.used}/${result.limit}).`,
        tracked,
      };
    }
    return {
      ok: true,
      tracked: tracked.then(() => track(apiKey.id, { aiRequests: 1 })),
    };
  }

  if (tool.permission === 'export') {
    const result = await checkExportRateLimit(apiKey.id, tier);
    if (!result.ok) {
      return { ok: false, message: 'Service unavailable', tracked };
    }
    if (result.limited) {
      return {
        ok: false,
        message: `Daily export limit exceeded (${result.used}/${result.limit}).`,
        tracked,
      };
    }
    return {
      ok: true,
      tracked: tracked.then(() => track(apiKey.id, { exports: 1 })),
    };
  }

  return { ok: true, tracked };
}

/**
 * Is this tool visible to the acting key?
 *
 * Advertising a tool the caller may not call is a wasted round-trip, so
 * `tools/list` hides the ones this key lacks the permission for. The gate is
 * still the dispatch — hiding is convenience, not enforcement.
 *
 * @param {{permission?: string}} tool - The registered tool
 * @param {Object} [context] - Per-request tool context
 * @returns {boolean}
 */
export function isToolVisible(tool, context) {
  const apiKey = actingKey(context);
  if (!apiKey) return true;
  return (
    Boolean(tool.permission) &&
    hasPermission(apiKey.permissions, tool.permission)
  );
}
