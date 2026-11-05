/**
 * Storage for the AI call meter (DY-844, migration 108).
 *
 * Two counters per day. The organization rows say who spent what and are read
 * by that organization's admins; the instance row is what the daily ceiling is
 * held against. The transport (`server/utils/llm/meter.js`) is the only
 * writer: it reserves a call on the instance row before the model is called
 * and records the call and its tokens on the organization row afterwards.
 *
 * The instance row is keyed by the date alone, like instance configuration
 * (`docs/reference/storage-scope.md` § category 3): its functions take a
 * reasoned instance scope and never read an organization's rows.
 */

import { sql } from 'kysely';
import { withDbGuard } from '../db/client.js';
import { toStorageContext } from './scope.js';
import { normalizeEmail } from '../../shared/email.js';
import {
  resolveNamesForAddresses,
  toStoredActorIdentity,
} from './display-identity.js';

/** The UTC day a call is counted on, `YYYY-MM-DD`. */
export function usageDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * A DATE column as `YYYY-MM-DD`. node-postgres hands a DATE back as a `Date`
 * at local midnight, so the local components are the stored day; a string
 * (the test double) is already that.
 * @param {Date|string} value
 * @returns {string}
 */
function dayOf(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** A counter column as a number: BIGINT arrives as a string. */
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Reserve one model call on today's instance counter, atomically against the
 * ceiling: the row is incremented only while it is below `limit`, so two
 * concurrent calls cannot both take the last slot.
 *
 * @param {import('./scope.js').StorageScope} scope - A reasoned instance scope.
 * @param {{ day: string, limit: number }} input - `limit` 0 means no ceiling.
 * @returns {Promise<{ ok: true, used: number } | { ok: false, reason: 'rate_limited', used: number } | { ok: false, reason: 'unavailable' }>}
 */
export async function reserveInstanceAiCall(scope, { day, limit }) {
  toStorageContext(
    scope,
    'reserveInstanceAiCall',
    {},
    { allowCrossOrganization: true },
  );
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const row = await db
      .insertInto('ai_usage_instance_daily')
      .values({ date: day, calls: 1 })
      .onConflict((oc) => {
        const update = oc.column('date').doUpdateSet({
          calls: sql`COALESCE(ai_usage_instance_daily.calls, 0) + ${1}`,
        });
        return limit > 0
          ? update.where('ai_usage_instance_daily.calls', '<', limit)
          : update;
      })
      .returning(['calls'])
      .executeTakeFirst();
    if (row) return { ok: true, used: num(row.calls) };
    const current = await db
      .selectFrom('ai_usage_instance_daily')
      .select(['calls'])
      .where('date', '=', day)
      .executeTakeFirst();
    return { ok: false, reason: 'rate_limited', used: num(current?.calls) };
  });
}

/**
 * Today's instance total, for the admin view next to the ceiling.
 * @param {import('./scope.js').StorageScope} scope - A reasoned instance scope.
 * @param {{ day: string }} input
 * @returns {Promise<number>}
 */
export async function getInstanceAiCalls(scope, { day }) {
  toStorageContext(
    scope,
    'getInstanceAiCalls',
    {},
    { allowCrossOrganization: true },
  );
  return withDbGuard(0, async (db) => {
    const row = await db
      .selectFrom('ai_usage_instance_daily')
      .select(['calls'])
      .where('date', '=', day)
      .executeTakeFirst();
    return num(row?.calls);
  });
}

/**
 * Add one call and its tokens to the organization row of the scope's actor.
 *
 * @param {import('./scope.js').StorageScope} scope - The organization the call
 *   was made for; its `actorEmail` is the person (absent: nobody).
 * @param {{ day: string, calls?: number, inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number }} input
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function recordOrganizationAiUsage(scope, input) {
  const context = toStorageContext(scope, 'recordOrganizationAiUsage');
  const calls = num(input.calls);
  const inputTokens = num(input.inputTokens);
  const outputTokens = num(input.outputTokens);
  const cacheReadTokens = num(input.cacheReadTokens);
  const cacheWriteTokens = num(input.cacheWriteTokens);
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    await db
      .insertInto('ai_usage_daily')
      .values({
        organization_id: context.organizationId,
        date: input.day,
        actor_email: normalizeEmail(context.actorEmail) || '',
        calls,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
      })
      .onConflict((oc) =>
        oc.columns(['organization_id', 'date', 'actor_email']).doUpdateSet({
          calls: sql`COALESCE(ai_usage_daily.calls, 0) + ${calls}`,
          input_tokens: sql`COALESCE(ai_usage_daily.input_tokens, 0) + ${inputTokens}`,
          output_tokens: sql`COALESCE(ai_usage_daily.output_tokens, 0) + ${outputTokens}`,
          cache_read_tokens: sql`COALESCE(ai_usage_daily.cache_read_tokens, 0) + ${cacheReadTokens}`,
          cache_write_tokens: sql`COALESCE(ai_usage_daily.cache_write_tokens, 0) + ${cacheWriteTokens}`,
        }),
      )
      .execute();
    return { ok: true };
  });
}

/** Sum counter rows into one total. */
function sumRows(rows) {
  const total = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const row of rows) {
    total.calls += num(row.calls);
    total.inputTokens += num(row.input_tokens);
    total.outputTokens += num(row.output_tokens);
    total.cacheReadTokens += num(row.cache_read_tokens);
    total.cacheWriteTokens += num(row.cache_write_tokens);
  }
  return total;
}

/**
 * The scope's organization spend: a total per day for the last `days` days
 * (newest first, days without calls left out) and today's spend per person.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {{ today: string, days?: number }} input
 * @returns {Promise<{ ok: true, days: Array<{ day: string } & ReturnType<typeof sumRows>>, today: { day: string, total: ReturnType<typeof sumRows>, people: Array<{ person: Object|null } & ReturnType<typeof sumRows>> } } | { ok: false, reason: string }>}
 */
export async function listOrganizationAiUsage(scope, { today, days = 30 }) {
  const context = toStorageContext(scope, 'listOrganizationAiUsage');
  const span = Math.min(Math.max(Math.floor(days) || 1, 1), 90);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (span - 1));
  const from = usageDay(start);

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const rows = await db
      .selectFrom('ai_usage_daily')
      .selectAll()
      .where('organization_id', '=', context.organizationId)
      .where('date', '>=', from)
      .execute();

    const byDay = new Map();
    const todayRows = [];
    for (const row of rows) {
      const day = dayOf(row.date);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(row);
      if (day === today) todayRows.push(row);
    }
    const dayTotals = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([day, list]) => ({ day, ...sumRows(list) }));

    const lookup = await resolveNamesForAddresses(
      scope,
      todayRows.map((row) => row.actor_email),
    );
    const people = todayRows
      .map((row) => ({
        person: row.actor_email
          ? toStoredActorIdentity(row.actor_email, null, lookup)
          : null,
        ...sumRows([row]),
      }))
      .sort((a, b) => b.calls - a.calls);

    return {
      ok: true,
      days: dayTotals,
      today: { day: today, total: sumRows(todayRows), people },
    };
  });
}
