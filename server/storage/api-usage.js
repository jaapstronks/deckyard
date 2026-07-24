/**
 * Storage layer for API usage tracking.
 * Handles daily usage aggregates and rate limit checks.
 */

import { sql } from 'kysely';
import { withDbGuard } from './utils/db-guard.js';
import { TIER_LIMITS } from './api-keys.js';

// ============================================================
// USAGE TRACKING
// ============================================================

/**
 * Get today's date in YYYY-MM-DD format.
 * @returns {string}
 */
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Increment usage counters for an API key.
 * @param {string} apiKeyId - The API key ID
 * @param {Object} counters - Counters to increment
 * @param {number} [counters.requests] - Request count to add
 * @param {number} [counters.aiRequests] - AI request count to add
 * @param {number} [counters.exports] - Export count to add
 * @returns {Promise<Object>} - Updated usage totals for today
 */
export async function incrementUsage(apiKeyId, counters = {}) {
  if (!apiKeyId) {
    return { ok: false, reason: 'api_key_id_required' };
  }

  const { requests = 0, aiRequests = 0, exports = 0 } = counters;

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const date = getTodayDate();

    // Use INSERT ... ON CONFLICT for atomic upsert
    await db
      .insertInto('api_usage_daily')
      .values({
        api_key_id: apiKeyId,
        date,
        request_count: requests,
        ai_request_count: aiRequests,
        export_count: exports,
      })
      .onConflict((oc) =>
        oc.columns(['api_key_id', 'date']).doUpdateSet({
          request_count: sql`COALESCE(api_usage_daily.request_count, 0) + ${requests}`,
          ai_request_count: sql`COALESCE(api_usage_daily.ai_request_count, 0) + ${aiRequests}`,
          export_count: sql`COALESCE(api_usage_daily.export_count, 0) + ${exports}`,
        })
      )
      .execute();

    // Fetch updated totals
    const row = await db
      .selectFrom('api_usage_daily')
      .selectAll()
      .where('api_key_id', '=', apiKeyId)
      .where('date', '=', date)
      .executeTakeFirst();

    return {
      ok: true,
      date,
      requestCount: row?.request_count || 0,
      aiRequestCount: row?.ai_request_count || 0,
      exportCount: row?.export_count || 0,
    };
  });
}

/**
 * Get today's usage for an API key.
 * @param {string} apiKeyId - The API key ID
 * @returns {Promise<Object>} - Usage totals for today
 */
export async function getTodayUsage(apiKeyId) {
  if (!apiKeyId) {
    return { ok: false, reason: 'api_key_id_required' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const date = getTodayDate();

    const row = await db
      .selectFrom('api_usage_daily')
      .selectAll()
      .where('api_key_id', '=', apiKeyId)
      .where('date', '=', date)
      .executeTakeFirst();

    return {
      ok: true,
      date,
      requestCount: row?.request_count || 0,
      aiRequestCount: row?.ai_request_count || 0,
      exportCount: row?.export_count || 0,
    };
  });
}

/**
 * Get usage history for an API key.
 * @param {string} apiKeyId - The API key ID
 * @param {Object} options - Query options
 * @param {number} [options.days] - Number of days to fetch (default 30)
 * @returns {Promise<Object>} - Usage history
 */
export async function getUsageHistory(apiKeyId, options = {}) {
  if (!apiKeyId) {
    return { ok: false, reason: 'api_key_id_required' };
  }

  const { days = 30 } = options;

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const rows = await db
      .selectFrom('api_usage_daily')
      .selectAll()
      .where('api_key_id', '=', apiKeyId)
      .where('date', '>=', startDateStr)
      .orderBy('date', 'desc')
      .execute();

    const history = rows.map(row => ({
      date: row.date,
      requestCount: row.request_count || 0,
      aiRequestCount: row.ai_request_count || 0,
      exportCount: row.export_count || 0,
    }));

    // Calculate totals
    const totals = {
      requestCount: 0,
      aiRequestCount: 0,
      exportCount: 0,
    };
    for (const day of history) {
      totals.requestCount += day.requestCount;
      totals.aiRequestCount += day.aiRequestCount;
      totals.exportCount += day.exportCount;
    }

    return {
      ok: true,
      days,
      history,
      totals,
    };
  });
}

// ============================================================
// RATE LIMIT CHECKING
// ============================================================

/**
 * Check if an API key has exceeded its daily AI request limit.
 * @param {string} apiKeyId - The API key ID
 * @param {string} tier - The key's tier
 * @returns {Promise<Object>} - Rate limit check result
 */
export async function checkAiRateLimit(apiKeyId, tier = 'free') {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;

  // Unlimited tier
  if (limits.aiCallsPerDay < 0) {
    return { ok: true, limited: false, remaining: -1 };
  }

  const usage = await getTodayUsage(apiKeyId);
  if (!usage.ok) {
    return usage;
  }

  const remaining = Math.max(0, limits.aiCallsPerDay - usage.aiRequestCount);
  const limited = remaining <= 0;

  return {
    ok: true,
    limited,
    remaining,
    limit: limits.aiCallsPerDay,
    used: usage.aiRequestCount,
  };
}

/**
 * Check if an API key has exceeded its daily export limit.
 * @param {string} apiKeyId - The API key ID
 * @param {string} tier - The key's tier
 * @returns {Promise<Object>} - Rate limit check result
 */
export async function checkExportRateLimit(apiKeyId, tier = 'free') {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;

  // Unlimited tier
  if (limits.exportsPerDay < 0) {
    return { ok: true, limited: false, remaining: -1 };
  }

  const usage = await getTodayUsage(apiKeyId);
  if (!usage.ok) {
    return usage;
  }

  const remaining = Math.max(0, limits.exportsPerDay - usage.exportCount);
  const limited = remaining <= 0;

  return {
    ok: true,
    limited,
    remaining,
    limit: limits.exportsPerDay,
    used: usage.exportCount,
  };
}

/**
 * Get rate limit info for response headers.
 * @param {string} apiKeyId - The API key ID
 * @param {string} tier - The key's tier
 * @param {string} limitType - Type of limit (requests, ai, exports)
 * @returns {Promise<Object>} - Rate limit header values
 */
export async function getRateLimitHeaders(apiKeyId, tier = 'free', limitType = 'requests') {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;
  const usage = await getTodayUsage(apiKeyId);

  if (!usage.ok) {
    return {
      'X-RateLimit-Limit': '0',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': Math.floor(Date.now() / 1000),
    };
  }

  // Calculate reset time (midnight UTC)
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const resetTime = Math.floor(tomorrow.getTime() / 1000);

  let limit, used;
  switch (limitType) {
    case 'ai':
      limit = limits.aiCallsPerDay;
      used = usage.aiRequestCount;
      break;
    case 'exports':
      limit = limits.exportsPerDay;
      used = usage.exportCount;
      break;
    default:
      // For per-minute request limits, we don't track in DB
      // Return daily totals as informational
      limit = limits.requestsPerMinute * 60 * 24; // Theoretical daily max
      used = usage.requestCount;
  }

  const remaining = limit < 0 ? -1 : Math.max(0, limit - used);

  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(resetTime),
  };
}

// ============================================================
// CLEANUP
// ============================================================

/**
 * Cleanup old usage records (older than 90 days).
 * @returns {Promise<number>} - Number of records deleted
 */
export async function cleanupOldUsage() {
  return withDbGuard(0, async (db) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    const result = await db
      .deleteFrom('api_usage_daily')
      .where('date', '<', cutoffDateStr)
      .executeTakeFirst();

    return Number(result.numDeletedRows) || 0;
  });
}
