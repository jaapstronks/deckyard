/**
 * The per-slide lifecycle of a live interaction, on PostgreSQL.
 *
 * A live slide that collects answers has two halves: a lifecycle (which kind it
 * is, whether it is open or closed, how many options it offers) and the answers
 * themselves. This module owns the first half — one `interactions` row per
 * `(session_id, slide_id)` — for all three kinds. The answers live elsewhere,
 * shaped by what they are: indexed choices in `interaction_votes`
 * (`storage/interactions.js`), free text in `feedback` (`storage/feedback.js`).
 *
 * Feedback sharing this table is deliberate, not a shortcut. `liveInteractionKind()`
 * returns `'poll' | 'likert' | 'feedback'` from one list, the presenter route
 * opens, closes and resets all three through one code path, and the follow
 * client renders all three from one `interactionState` payload. The lifecycle is
 * one concept; giving feedback a parallel table for it would be a second shape
 * for the same meaning. The `feedback` table 001 created has no status column
 * precisely because the status was never per-entry.
 *
 * Every function returns `null` when the session does not exist. That is a
 * foreign-key violation rather than an empty read — `interactions.session_id`
 * references `present_sessions`, which is what guarantees a stale interaction
 * can never outlive its session (the cascade collects it).
 */

import { withDbGuard } from './utils/db-guard.js';

/** Hard ceiling on authored options, matching the file format's clamp. */
export const MAX_OPTIONS = 10;

/**
 * Coerce to an integer inside a range, defaulting to `min` for anything
 * non-finite. Shared with the vote store, which clamps option indexes the same
 * way it clamps option counts.
 *
 * @param {*} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

/**
 * Normalize a status to the two values the column carries.
 * @param {*} status
 * @returns {'open'|'closed'}
 */
export function normalizeStatus(status) {
  return String(status) === 'closed' ? 'closed' : 'open';
}

/**
 * A foreign-key violation, i.e. "there is no such live session".
 *
 * Callers reach the storage layer through routes that already resolved a live
 * session, so this is the narrow race where the session ended in between. It is
 * a `null` return, not a 500.
 *
 * @param {*} err
 * @returns {boolean}
 */
function isMissingSession(err) {
  return String(err?.code || '') === '23503';
}

/**
 * Epoch millis from a timestamptz column (a Date from the driver).
 * @param {*} value
 * @returns {number}
 */
function toMillis(value) {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * @typedef {object} InteractionSlide
 * @property {string} id - `interactions.id`, the key the answers hang off.
 * @property {string} sessionId
 * @property {string} slideId
 * @property {'poll'|'likert'|'feedback'} type
 * @property {'open'|'closed'} status
 * @property {number} optionCount
 * @property {number} createdAt - Epoch millis.
 * @property {number} updatedAt - Epoch millis.
 */

/**
 * @param {object} row
 * @returns {InteractionSlide}
 */
function rowToSlide(row) {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    slideId: String(row.slide_id),
    type: String(row.type || ''),
    status: normalizeStatus(row.status),
    optionCount: clampInt(row.option_count, 0, MAX_OPTIONS),
    createdAt: toMillis(row.created_at) || Date.now(),
    updatedAt: toMillis(row.updated_at) || Date.now(),
  };
}

const SLIDE_COLUMNS = [
  'id',
  'session_id',
  'slide_id',
  'type',
  'status',
  'option_count',
  'created_at',
  'updated_at',
];

/**
 * Create the interaction for a slide, or refresh the kind and option count of
 * the one already there. `defaultStatus` applies on creation only: re-ensuring
 * must never reopen an interaction the presenter closed.
 *
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.slideId
 * @param {'poll'|'likert'|'feedback'} opts.type
 * @param {number} [opts.optionCount]
 * @param {'open'|'closed'} [opts.defaultStatus]
 * @returns {Promise<{ok: true, slide: InteractionSlide}|{ok: false, reason: string}>}
 *   `invalid` for a blank id or type, `not_found` when the session is gone,
 *   `unavailable` when the pool is down.
 */
export async function ensureInteractionSlide({
  sessionId,
  slideId,
  type,
  optionCount = 0,
  defaultStatus = 'open',
}) {
  const sid = String(sessionId || '').trim();
  const slide = String(slideId || '').trim();
  if (!sid || !slide || !type) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const values = {
      session_id: sid,
      slide_id: slide,
      type,
      status: normalizeStatus(defaultStatus),
      option_count: clampInt(optionCount, 0, MAX_OPTIONS),
      updated_at: new Date(),
    };
    try {
      const row = await db
        .insertInto('interactions')
        .values(values)
        .onConflict((oc) =>
          oc.columns(['session_id', 'slide_id']).doUpdateSet({
            type: values.type,
            option_count: values.option_count,
            updated_at: values.updated_at,
          })
        )
        .returning(SLIDE_COLUMNS)
        .executeTakeFirst();
      return row ? { ok: true, slide: rowToSlide(row) } : { ok: false, reason: 'not_found' };
    } catch (err) {
      if (isMissingSession(err)) return { ok: false, reason: 'not_found' };
      throw err;
    }
  });
}

/**
 * Read the interaction for a slide without creating one.
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.slideId
 * @returns {Promise<InteractionSlide|null>}
 */
export async function getInteractionSlide({ sessionId, slideId }) {
  const sid = String(sessionId || '').trim();
  const slide = String(slideId || '').trim();
  if (!sid || !slide) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('interactions')
      .select(SLIDE_COLUMNS)
      .where('session_id', '=', sid)
      .where('slide_id', '=', slide)
      .executeTakeFirst();
    return row ? rowToSlide(row) : null;
  });
}

/**
 * Update an existing interaction's status and/or option count. Fields left
 * undefined stay as they are; `updated_at` moves either way, because both are
 * presenter actions rather than reads.
 *
 * Reads deliberately do **not** touch `updated_at`. The file-backed version
 * bumped it on every aggregate read, which made the timestamp a record of the
 * last poll rather than of the last change — and wrote to disk on a GET.
 *
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.slideId
 * @param {'open'|'closed'} [opts.status]
 * @param {number} [opts.optionCount]
 * @returns {Promise<{ok: true, slide: InteractionSlide}|{ok: false, reason: string}>}
 *   `invalid` for a blank id, `not_found` when no such interaction exists,
 *   `unavailable` when the pool is down.
 */
export async function updateInteractionSlide({ sessionId, slideId, status, optionCount }) {
  const sid = String(sessionId || '').trim();
  const slide = String(slideId || '').trim();
  if (!sid || !slide) return { ok: false, reason: 'invalid' };

  /** @type {Record<string, any>} */
  const set = { updated_at: new Date() };
  if (status !== undefined) set.status = normalizeStatus(status);
  if (optionCount !== undefined && optionCount !== null) {
    set.option_count = clampInt(optionCount, 0, MAX_OPTIONS);
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const row = await db
      .updateTable('interactions')
      .set(set)
      .where('session_id', '=', sid)
      .where('slide_id', '=', slide)
      .returning(SLIDE_COLUMNS)
      .executeTakeFirst();
    return row ? { ok: true, slide: rowToSlide(row) } : { ok: false, reason: 'not_found' };
  });
}
