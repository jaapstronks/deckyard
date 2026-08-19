/**
 * Session-scoped feedback storage (per slide, per device), on PostgreSQL.
 *
 * - Not shown on slides (only collected via follow UI)
 * - Presenter can export as CSV/JSON
 *
 * One row per `(session_id, slide_id, device_id)` — the unique constraint
 * migration 001 created, which is exactly the "one entry per device, editable"
 * rule the file format expressed as an `entriesByDevice` map. Resubmitting
 * updates the text and keeps the original `created_at`.
 *
 * The per-slide open/closed status is **not** here: it is an `interactions` row
 * of type `'feedback'` (`storage/interaction-slides.js`), shared with polls and
 * likerts, because that lifecycle is one concept across all three live kinds.
 * This module owns the answers, as the free-text sibling of `interaction_votes`.
 *
 * This replaces a per-session JSON file on disk (`feedback/<sessionId>.json`), written
 * regardless of `STORAGE_MODE` and — because expired sessions were explicitly
 * kept on disk — never collected. Collection is now the `ON DELETE CASCADE`
 * from `present_sessions`.
 */

import { sql } from 'kysely';

import { notifyLiveSessionInteractionState } from './live-sessions/index.js';
import { maybeFireInteractionWebhook } from '../utils/webhooks.js';
import { repoRootOf, toStorageContext } from './scope.js';
import { withDbGuard } from './utils/db-guard.js';
import {
  ensureInteractionSlide,
  getInteractionSlide,
  updateInteractionSlide,
} from './interaction-slides.js';

/** Free text is capped so an export stays sane and a row stays bounded. */
const MAX_TEXT_LENGTH = 4000;

/** Device ids arrive in a client-controlled cookie; clamp to the column width. */
const MAX_DEVICE_ID_LENGTH = 100;

function now() {
  return Date.now();
}

/**
 * @param {*} v
 * @returns {string}
 */
function normalizeDeviceId(v) {
  return String(v || '').trim().slice(0, MAX_DEVICE_ID_LENGTH);
}

/**
 * Epoch millis from a timestamptz column.
 * @param {*} value
 * @returns {number}
 */
function toMillis(value) {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Entry count plus this device's own text, in one round trip.
 *
 * @param {string} sessionId
 * @param {string} slideId
 * @param {string|null} deviceId
 * @returns {Promise<{ total: number, myText: string|null }>}
 */
async function readEntrySummary(sessionId, slideId, deviceId) {
  const did = normalizeDeviceId(deviceId);
  return withDbGuard({ total: 0, myText: null }, async (db) => {
    const { rows } = await sql`
      SELECT
        count(*)::int AS total,
        max(text) FILTER (WHERE device_id = ${did || null}) AS mine
      FROM feedback
      WHERE session_id = ${sessionId} AND slide_id = ${slideId}
    `.execute(db);
    const row = rows?.[0] || {};
    return {
      total: Number(row.total || 0),
      myText: did && typeof row.mine === 'string' ? row.mine : null,
    };
  });
}

/**
 * Build the payload the presenter and the follow client both render.
 *
 * @param {import('./interaction-slides.js').InteractionSlide} slide
 * @param {string|null} deviceId
 * @returns {Promise<object>}
 */
async function aggregateForDevice(slide, deviceId) {
  const { total, myText } = await readEntrySummary(slide.sessionId, slide.slideId, deviceId);
  return {
    slideId: slide.slideId,
    type: 'feedback',
    status: slide.status,
    open: slide.status !== 'closed',
    total,
    myText: myText ?? undefined,
    updatedAt: slide.updatedAt || now(),
  };
}

async function maybeBroadcast(scope, sessionId, agg) {
  try {
    await notifyLiveSessionInteractionState(scope, sessionId, agg);
  } catch {
    // ignore
  }
}

/**
 * Create the feedback interaction for a slide if it has none.
 *
 * Capability-based: reachable from the sessionless follow surface, where the
 * live session id is the authorization, so an audience scope may act
 * cross-organization (see routes/api/follow/helpers.js).
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {string} [opts.slideId]
 * @param {'open'|'closed'} [opts.defaultStatus]
 * @returns {Promise<{ok: true, aggregate: object}|{ok: false, reason: string}>}
 *   The reason is whatever `ensureInteractionSlide` answered — `invalid` for a
 *   blank id, `not_found` when there is no such session.
 */
export async function ensureFeedbackForSlide(
  scope,
  sessionId,
  { slideId = '', defaultStatus = 'open' } = {}
) {
  toStorageContext(scope, 'ensureFeedbackForSlide', {}, { allowCrossOrganization: true });
  const ensured = await ensureInteractionSlide({
    sessionId,
    slideId,
    type: 'feedback',
    optionCount: 0,
    defaultStatus,
  });
  if (!ensured.ok) return ensured;

  const agg = await aggregateForDevice(ensured.slide, null);
  await maybeBroadcast(scope, sessionId, agg);
  return { ok: true, aggregate: agg };
}

/**
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {string} [opts.slideId]
 * @param {string|null} [opts.deviceId]
 * @returns {Promise<object|null>}
 */
export async function getFeedbackAggregate(
  scope,
  sessionId,
  { slideId = '', deviceId = null } = {}
) {
  toStorageContext(scope, 'getFeedbackAggregate', {}, { allowCrossOrganization: true });
  const slide = await getInteractionSlide({ sessionId, slideId });
  if (!slide) return null;
  return aggregateForDevice(slide, deviceId);
}

/**
 * Submit (or replace) one device's feedback on a slide.
 *
 * Capability-based audience write: the row is keyed on the session the public
 * follow code resolved, so the scope may be cross-organization (the A1
 * org-scoping decision owns whether this domain ever becomes org-filtered).
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<{ok: true, aggregate: object}|{ok: false, reason: string}>}
 *   `invalid` for a blank slide or device id and for empty text, `closed` when
 *   the presenter shut the slide, and otherwise whatever
 *   `ensureInteractionSlide` answered (`not_found` for a session that is gone,
 *   `unavailable` when the pool is down).
 */
export async function submitFeedback(
  scope,
  sessionId,
  { slideId = '', deviceId = '', text = '' } = {}
) {
  toStorageContext(scope, 'submitFeedback', {}, { allowCrossOrganization: true });
  const sid = String(slideId || '').trim();
  const did = normalizeDeviceId(deviceId);
  if (!sid || !did) return { ok: false, reason: 'invalid' };

  const t = String(text || '').trim();
  // Empty text is malformed input, not its own outcome: nothing downstream
  // acts on the difference between a blank id and a blank body.
  if (!t) return { ok: false, reason: 'invalid' };
  const limited = t.length > MAX_TEXT_LENGTH ? t.slice(0, MAX_TEXT_LENGTH) : t;

  // Auto-create so the first respondent never needs a presenter action, the
  // same way a first voter creates a poll's interaction.
  const ensured = await ensureInteractionSlide({
    sessionId,
    slideId: sid,
    type: 'feedback',
    optionCount: 0,
  });
  // Pass the reason through: `not_found` (session gone) and `unavailable`
  // (pool down) are different answers and must not collapse into one.
  if (!ensured.ok) return ensured;
  const slide = ensured.slide;
  if (slide.status === 'closed') return { ok: false, reason: 'closed' };

  await withDbGuard(undefined, async (db) => {
    await db
      .insertInto('feedback')
      .values({
        session_id: slide.sessionId,
        slide_id: slide.slideId,
        device_id: did,
        text: limited,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.columns(['session_id', 'slide_id', 'device_id']).doUpdateSet({
          text: limited,
          updated_at: new Date(),
        })
      )
      .execute();
  });
  const bumped = await updateInteractionSlide({ sessionId, slideId: sid });
  const touched = bumped.ok ? bumped.slide : slide;

  const aggForDevice = await aggregateForDevice(touched, did);
  const aggForBroadcast = await aggregateForDevice(touched, null);
  await maybeBroadcast(scope, sessionId, aggForBroadcast);

  maybeFireInteractionWebhook(repoRootOf(scope), {
    event: 'interaction.feedback_submitted',
    sessionId,
    interaction: aggForBroadcast,
  }).catch(() => {});

  return { ok: true, aggregate: aggForDevice };
}

/**
 * Open or close feedback collection on a slide (presenter action).
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<{ok: true, aggregate: object}|{ok: false, reason: string}>}
 *   `invalid` for a blank id, `not_found` when the slide has no feedback
 *   interaction (it was never ensured, or the session expired mid-request).
 */
export async function setFeedbackStatus(
  scope,
  sessionId,
  { slideId = '', status = 'open' } = {}
) {
  toStorageContext(scope, 'setFeedbackStatus');
  const updated = await updateInteractionSlide({ sessionId, slideId, status });
  if (!updated.ok) return updated;
  const agg = await aggregateForDevice(updated.slide, null);
  await maybeBroadcast(scope, sessionId, agg);
  return { ok: true, aggregate: agg };
}

/**
 * Discard every entry on a slide (presenter action).
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<{ok: true, aggregate: object}|{ok: false, reason: string}>}
 *   `invalid` for a blank id, `not_found` when the slide has no feedback
 *   interaction (it was never ensured, or the session expired mid-request).
 */
export async function resetFeedback(scope, sessionId, { slideId = '' } = {}) {
  toStorageContext(scope, 'resetFeedback');
  const updated = await updateInteractionSlide({ sessionId, slideId });
  if (!updated.ok) return updated;
  const slide = updated.slide;

  await withDbGuard(undefined, async (db) => {
    await db
      .deleteFrom('feedback')
      .where('session_id', '=', slide.sessionId)
      .where('slide_id', '=', slide.slideId)
      .execute();
  });

  const agg = await aggregateForDevice(slide, null);
  await maybeBroadcast(scope, sessionId, agg);
  return { ok: true, aggregate: agg };
}

/**
 * Every entry on a slide, for the presenter's CSV/JSON export.
 *
 * Ordered in SQL by the same key the file version sorted on in JavaScript, so
 * two exports of the same data are byte-identical.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {string} [opts.slideId]
 * @returns {Promise<Array<{slideId: string, deviceId: string, text: string, createdAt: number, updatedAt: number}>>}
 */
export async function listFeedbackEntries(scope, sessionId, { slideId = '' } = {}) {
  toStorageContext(scope, 'listFeedbackEntries');
  const sid = String(sessionId || '').trim();
  const slide = String(slideId || '').trim();
  if (!sid || !slide) return [];

  return withDbGuard([], async (db) => {
    const rows = await db
      .selectFrom('feedback')
      .select(['slide_id', 'device_id', 'text', 'created_at', 'updated_at'])
      .where('session_id', '=', sid)
      .where('slide_id', '=', slide)
      .orderBy('created_at', 'asc')
      .orderBy('updated_at', 'asc')
      .orderBy('device_id', 'asc')
      .execute();

    return rows.map((row) => ({
      slideId: String(row.slide_id),
      deviceId: String(row.device_id),
      text: typeof row.text === 'string' ? row.text : '',
      createdAt: toMillis(row.created_at),
      updatedAt: toMillis(row.updated_at),
    }));
  });
}
