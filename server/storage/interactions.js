/**
 * Follow-native interactions storage (session-scoped), on PostgreSQL.
 *
 * Authoritative key: `{ sessionId, slideId }` (NOT pollId). One vote per device
 * per interaction, changeable — which is `interaction_votes`' primary key
 * `(interaction_id, device_id)`, so the "one vote per device" rule is enforced
 * by the database rather than by a Map in one process.
 *
 * This replaces a per-session JSON file on disk (`interactions/<sessionId>.json`). That
 * file was written regardless of `STORAGE_MODE`, was only visible to the process
 * that held the session in its `sessions` map, and — because expired sessions
 * were explicitly "left on disk for now" — was never collected. All three are
 * gone: the rows are shared, and `present_sessions` cascades them away when the
 * session ends or the sweep collects it.
 *
 * The per-slide lifecycle (kind, open/closed, option count) is not here; it is
 * `storage/interaction-slides.js`, shared with feedback. What is here is the
 * answers and the aggregate built from them.
 *
 * Totals are never stored. They are `count(*) GROUP BY option_index` over the
 * votes, which is the same "votes are the single source of truth" rule the file
 * version enforced in JavaScript — now enforced by not having anywhere else to
 * put the number.
 */

import { sql } from 'kysely';

import { notifyLiveSessionInteractionState } from './live-sessions/index.js';
import { maybeFireInteractionWebhook } from '../utils/webhooks.js';
import { toStorageContext } from './backend-dispatch.js';
import { repoRootOf } from './scope.js';
import { withDbGuard } from './utils/db-guard.js';
import {
  MAX_OPTIONS,
  clampInt,
  ensureInteractionSlide,
  getInteractionSlide,
  updateInteractionSlide,
} from './interaction-slides.js';

/**
 * Device ids come from a cookie the client controls, so they are clamped to the
 * column width rather than trusted. `varchar(100)` comfortably holds the uuid
 * the server mints; a longer value is a forged cookie, not a device.
 */
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
 * @param {*} type
 * @returns {'poll'|'likert'}
 */
function normalizeInteractionType(type) {
  const t = String(type || '').trim();
  if (t === 'poll' || t === 'likert') return t;
  return 'poll';
}

/**
 * Vote counts per option, plus this device's own choice, in one round trip.
 *
 * The `FILTER` picks the caller's vote out of the same scan that counts the
 * rest, so an aggregate read is one query however large the audience is.
 *
 * @param {string} interactionId
 * @param {number} optionCount
 * @param {string|null} deviceId
 * @returns {Promise<{ totals: number[], myVote: number|null }>}
 */
async function readVotes(interactionId, optionCount, deviceId) {
  const n = clampInt(optionCount, 0, MAX_OPTIONS);
  const empty = { totals: Array.from({ length: n }, () => 0), myVote: null };
  const did = normalizeDeviceId(deviceId);

  return withDbGuard(empty, async (db) => {
    const { rows } = await sql`
      SELECT
        option_index,
        count(*)::int AS n,
        bool_or(device_id = ${did || null}) AS mine
      FROM interaction_votes
      WHERE interaction_id = ${interactionId}
      GROUP BY option_index
    `.execute(db);

    const totals = Array.from({ length: n }, () => 0);
    let myVote = null;
    for (const row of rows || []) {
      const idx = clampInt(row.option_index, -1, MAX_OPTIONS);
      if (idx >= 0 && idx < n) totals[idx] += Number(row.n || 0);
      if (did && row.mine) myVote = idx;
    }
    return { totals, myVote };
  });
}

/**
 * Drop votes that point outside the current option range.
 *
 * Shrinking a poll's options in the editor mid-session would otherwise leave
 * votes for options that no longer exist — the file version pruned them in
 * `ensureOptionCount`, this is the same rule as a DELETE.
 *
 * @param {string} interactionId
 * @param {number} optionCount
 * @returns {Promise<void>}
 */
async function pruneOutOfRangeVotes(interactionId, optionCount) {
  const n = clampInt(optionCount, 0, MAX_OPTIONS);
  await withDbGuard(undefined, async (db) => {
    await db
      .deleteFrom('interaction_votes')
      .where('interaction_id', '=', interactionId)
      .where('option_index', '>=', n)
      .execute();
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
  const { totals, myVote } = await readVotes(slide.id, slide.optionCount, deviceId);
  const total = totals.reduce((a, b) => a + b, 0);
  return {
    slideId: slide.slideId,
    type: slide.type,
    status: slide.status,
    open: slide.status !== 'closed',
    optionCount: slide.optionCount,
    totals,
    total,
    myVote: myVote ?? undefined,
    updatedAt: slide.updatedAt || now(),
  };
}

async function maybeBroadcast(scope, sessionId, agg) {
  // Fire and forget; this goes to presenter + follow (via attachSessionSseClient).
  try {
    await notifyLiveSessionInteractionState(scope, sessionId, agg);
  } catch {
    // ignore
  }
}

const BROADCAST_COALESCE_MS = 250;

/** @type {Map<string, { timer: any, lastSentAt: number }>} */
const broadcastStates = new Map();

function sweepBroadcastStates() {
  if (broadcastStates.size <= 500) return;
  // Anything idle for a full coalesce window has nothing pending; the entry is
  // only a rate-limit memory.
  const cutoff = now() - 60_000;
  for (const [key, b] of broadcastStates) {
    if (!b.timer && b.lastSentAt < cutoff) broadcastStates.delete(key);
  }
}

/**
 * Broadcast the aggregate for a slide's interaction, coalescing bursts of
 * votes into at most one fan-out per BROADCAST_COALESCE_MS (leading +
 * trailing edge). Without this, N near-simultaneous votes each trigger a
 * fan-out to all clients (O(N²) SSE writes during a vote burst).
 * Pass immediate=true for status changes/resets so open/close gating on
 * clients is never delayed.
 *
 * The aggregate is re-read at send time, so a coalesced broadcast always
 * carries the latest totals — including votes cast by another process.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {string} slideId
 * @param {object} [opts]
 * @param {boolean} [opts.immediate]
 * @returns {void}
 */
function scheduleInteractionBroadcast(scope, sessionId, slideId, { immediate = false } = {}) {
  const key = `${sessionId}\n${slideId}`;
  let b = broadcastStates.get(key);
  if (!b) {
    b = { timer: null, lastSentAt: 0 };
    broadcastStates.set(key, b);
    sweepBroadcastStates();
  }
  const send = () => {
    b.lastSentAt = now();
    (async () => {
      const slide = await getInteractionSlide({ sessionId, slideId });
      if (!slide) return;
      await maybeBroadcast(scope, sessionId, await aggregateForDevice(slide, null));
    })().catch(() => {});
  };
  if (immediate) {
    if (b.timer) {
      clearTimeout(b.timer);
      b.timer = null;
    }
    send();
    return;
  }
  if (b.timer) return;
  const wait = BROADCAST_COALESCE_MS - (now() - b.lastSentAt);
  if (wait <= 0) {
    send();
    return;
  }
  b.timer = setTimeout(() => {
    b.timer = null;
    send();
  }, wait);
  b.timer.unref?.();
}

/**
 * Create the interaction for a slide if it has none, and bring its kind and
 * option count up to date.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {'poll'|'likert'} [opts.type]
 * @param {string} [opts.slideId]
 * @param {number} [opts.optionCount]
 * @param {'open'|'closed'} [opts.defaultStatus]
 * @returns {Promise<object|null>} The aggregate, or null when there is no such session.
 */
async function ensureInteractionForSlide(
  scope,
  sessionId,
  { type = 'poll', slideId = '', optionCount = 0, defaultStatus = 'open' } = {}
) {
  const slide = await ensureInteractionSlide({
    sessionId,
    slideId,
    type: normalizeInteractionType(type),
    optionCount,
    defaultStatus,
  });
  if (!slide) return null;
  await pruneOutOfRangeVotes(slide.id, slide.optionCount);

  const agg = await aggregateForDevice(slide, null);
  scheduleInteractionBroadcast(scope, sessionId, slide.slideId);
  return agg;
}

/**
 * Read the aggregate for a slide, optionally reconciling the option count with
 * what the deck says today.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {string} [opts.slideId]
 * @param {string|null} [opts.deviceId]
 * @param {number|null} [opts.optionCount]
 * @returns {Promise<object|null>}
 */
async function getInteractionAggregate(
  scope,
  sessionId,
  { slideId = '', deviceId = null, optionCount = null } = {}
) {
  let slide = await getInteractionSlide({ sessionId, slideId });
  if (!slide) return null;
  if (optionCount != null && clampInt(optionCount, 0, MAX_OPTIONS) !== slide.optionCount) {
    slide = (await updateInteractionSlide({ sessionId, slideId, optionCount })) || slide;
    await pruneOutOfRangeVotes(slide.id, slide.optionCount);
  }
  return aggregateForDevice(slide, deviceId);
}

/**
 * Cast (or change) one device's vote.
 *
 * The interaction is created on the fly when a voter arrives before the
 * presenter's ensure call, so the first voter never needs a presenter action.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<{ok: true, aggregate: object}|{ok: false, reason: string}>}
 */
async function voteInteraction(
  scope,
  sessionId,
  { type = 'poll', slideId = '', deviceId = '', optionIndex = 0, optionCount = 0 } = {}
) {
  const did = normalizeDeviceId(deviceId);
  const sid = String(slideId || '').trim();
  if (!sid || !did) return { ok: false, reason: 'bad_request' };

  const slide = await ensureInteractionSlide({
    sessionId,
    slideId: sid,
    type: normalizeInteractionType(type),
    optionCount,
  });
  if (!slide) return { ok: false, reason: 'no_session' };
  await pruneOutOfRangeVotes(slide.id, slide.optionCount);
  if (slide.status === 'closed') return { ok: false, reason: 'closed' };

  const idx = clampInt(optionIndex, 0, Math.max(0, slide.optionCount - 1));
  await withDbGuard(undefined, async (db) => {
    await db
      .insertInto('interaction_votes')
      .values({
        interaction_id: slide.id,
        device_id: did,
        option_index: idx,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.columns(['interaction_id', 'device_id']).doUpdateSet({
          option_index: idx,
          updated_at: new Date(),
        })
      )
      .execute();
  });
  // A vote is a change to the interaction, so it moves `updated_at` — the
  // timestamp clients use to tell a fresh aggregate from a replayed one.
  const touched = (await updateInteractionSlide({ sessionId, slideId: sid })) || slide;

  const agg = await aggregateForDevice(touched, did);
  scheduleInteractionBroadcast(scope, sessionId, sid);
  return { ok: true, aggregate: agg };
}

/**
 * Open or close an interaction (presenter action), firing the close webhook.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<object|null>}
 */
async function setInteractionStatus(
  scope,
  sessionId,
  { slideId = '', status = 'open', optionCount = null } = {}
) {
  const existing = await getInteractionSlide({ sessionId, slideId });
  if (!existing) return null;

  const slide = await updateInteractionSlide({
    sessionId,
    slideId,
    status,
    ...(optionCount != null ? { optionCount } : {}),
  });
  if (!slide) return null;
  if (optionCount != null) await pruneOutOfRangeVotes(slide.id, slide.optionCount);

  const agg = await aggregateForDevice(slide, null);
  scheduleInteractionBroadcast(scope, sessionId, slide.slideId, { immediate: true });

  if (existing.status !== 'closed' && slide.status === 'closed') {
    const webhookEvent =
      slide.type === 'likert'
        ? 'interaction.likert_closed'
        : 'interaction.poll_closed';
    maybeFireInteractionWebhook(repoRootOf(scope), {
      event: webhookEvent,
      sessionId,
      interaction: agg,
    }).catch(() => {});
  }

  return agg;
}

/**
 * Clear every vote on an interaction (presenter action).
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<object|null>}
 */
async function resetInteraction(scope, sessionId, { slideId = '', optionCount = null } = {}) {
  const slide = await updateInteractionSlide({
    sessionId,
    slideId,
    ...(optionCount != null ? { optionCount } : {}),
  });
  if (!slide) return null;

  await withDbGuard(undefined, async (db) => {
    await db.deleteFrom('interaction_votes').where('interaction_id', '=', slide.id).execute();
  });

  const agg = await aggregateForDevice(slide, null);
  scheduleInteractionBroadcast(scope, sessionId, slide.slideId, { immediate: true });
  return agg;
}

// ---- Poll wrappers (back-compat) ----
//
// The audience half (ensure/get/vote) is capability-based — the live session
// id resolved from a public follow code is the authorization, so an audience
// scope may act cross-organization (see routes/api/follow/helpers.js). The
// presenter half (set status/reset) requires an organization-scoped scope.

export async function ensurePollInteractionForSlide(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'ensurePollInteractionForSlide', {}, { allowCrossOrganization: true });
  return ensureInteractionForSlide(scope, sessionId, { ...opts, type: 'poll' });
}

export async function getPollInteractionAggregate(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'getPollInteractionAggregate', {}, { allowCrossOrganization: true });
  return getInteractionAggregate(scope, sessionId, opts);
}

export async function votePollInteraction(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'votePollInteraction', {}, { allowCrossOrganization: true });
  return voteInteraction(scope, sessionId, { ...opts, type: 'poll' });
}

export async function setPollInteractionStatus(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'setPollInteractionStatus');
  return setInteractionStatus(scope, sessionId, opts);
}

export async function resetPollInteraction(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'resetPollInteraction');
  return resetInteraction(scope, sessionId, opts);
}

// ---- Likert (new) ----

export async function ensureLikertInteractionForSlide(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'ensureLikertInteractionForSlide', {}, { allowCrossOrganization: true });
  return ensureInteractionForSlide(scope, sessionId, { ...opts, type: 'likert' });
}

export async function getLikertInteractionAggregate(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'getLikertInteractionAggregate', {}, { allowCrossOrganization: true });
  return getInteractionAggregate(scope, sessionId, opts);
}

export async function voteLikertInteraction(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'voteLikertInteraction', {}, { allowCrossOrganization: true });
  return voteInteraction(scope, sessionId, { ...opts, type: 'likert' });
}

export async function setLikertInteractionStatus(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'setLikertInteractionStatus');
  return setInteractionStatus(scope, sessionId, opts);
}

export async function resetLikertInteraction(scope, sessionId, opts = {}) {
  toStorageContext(scope, 'resetLikertInteraction');
  return resetInteraction(scope, sessionId, opts);
}
