/**
 * Present-session persistence, on PostgreSQL.
 *
 * A live session is two things: a hot object (SSE client sockets, heartbeat
 * timers) that is necessarily process-local, and a small persisted record
 * (which deck, which slide, control on/off, follow codes) that has to survive a
 * restart. This module owns the second half; `state.js` holds the first.
 *
 * It replaces `disk.js`, which wrote one JSON file per session on disk
 * (`present-sessions/<sessionId>.json`) and read that directory **once per process**
 * (the `loadedRoots` guard). That made every session another process created
 * invisible: a second worker never saw them, and a session created after the
 * first read was only found because the same process had put it in the map.
 * Hydration here is per lookup instead — a miss in the map asks the table.
 *
 * What is *not* solved: SSE fan-out is still process-local. A follower attached
 * to worker B receives nothing when the presenter pushes state to worker A;
 * B only sees the new state when it reads (a poll, a fresh attach). Sharing the
 * fan-out itself needs a pub/sub substrate (the Redis step); this change moves
 * the *substrate of record*, and stops a restart or a second worker losing
 * sessions outright.
 *
 * Freshness rule: the in-memory copy wins unless the row is newer. Persistence
 * is debounced (600ms), so the local object is routinely ahead of the table,
 * and `last_activity_at` — bumped by every mutation — is the comparison.
 */

import { TTL_MS } from './constants.js';
import { sessions } from './state.js';
import { withDbGuard } from '../utils/db-guard.js';

/** Debounce window for persisting a mutated session. */
const PERSIST_DEBOUNCE_MS = 600;

/**
 * Is this session past its idle TTL?
 * @param {object} s - Session (in-memory or freshly hydrated).
 * @returns {boolean}
 */
export function isExpired(s) {
  const last = Number(s?.lastActivityAt || 0) || 0;
  if (!last) return true;
  return Date.now() - last > TTL_MS;
}

/**
 * The persisted half of a session: everything except sockets and timers.
 * @param {object} s
 * @returns {object}
 */
export function serializeSession(s) {
  return {
    sessionId: s.sessionId,
    presentationId: s.presentationId,
    state: s.state,
    controlEnabled: !!s.controlEnabled,
    followCodes: s.followCodes || {},
    followCodesCreatedAt: Number(s.followCodesCreatedAt || 0) || 0,
    createdAt: Number(s.createdAt || 0) || Date.now(),
    lastActivityAt: Number(s.lastActivityAt || 0) || Date.now(),
  };
}

/**
 * Normalize a session's slide state. Kept as its own step because a row (or,
 * before this change, a file) written by an older version may predate the step
 * fields, and every reader assumes they are present.
 * @param {*} raw
 * @returns {object}
 */
function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? { ...raw } : {};
  if (typeof state.slideId !== 'string') state.slideId = '';
  state.slideIndex = Number(state.slideIndex || 0) || 0;
  state.updatedAt = Number(state.updatedAt || 0) || Date.now();
  state.stepIdx = Math.max(0, Number(state.stepIdx || 0) || 0);
  if (typeof state.stepParagraphs !== 'boolean') state.stepParagraphs = false;
  if (typeof state.slideType !== 'string') state.slideType = '';
  return state;
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
 * Turn a `present_sessions` row into the persisted half of a session object.
 * @param {object} row
 * @returns {object}
 */
function rowToSession(row) {
  return {
    sessionId: String(row.session_id),
    presentationId: String(row.presentation_id),
    state: normalizeState(row.state),
    controlEnabled: !!row.control_enabled,
    followCodes: row.follow_codes && typeof row.follow_codes === 'object' ? row.follow_codes : {},
    followCodesCreatedAt: toMillis(row.follow_codes_created_at),
    createdAt: toMillis(row.created_at) || Date.now(),
    lastActivityAt: toMillis(row.last_activity_at) || Date.now(),
  };
}

/**
 * Merge a row into the live map: adopt it when the session is unknown here,
 * refresh the persisted fields when the row is newer than what this process
 * holds, and leave the hot fields (clients, timers) alone either way.
 *
 * @param {object} row - A `present_sessions` row.
 * @returns {object|null} The live session, or null when the row is expired and
 *   this process was not already holding it.
 */
function mergeRow(row) {
  const incoming = rowToSession(row);
  const existing = sessions.get(incoming.sessionId);

  if (!existing) {
    if (isExpired(incoming)) return null;
    const session = {
      ...incoming,
      clients: new Set(),
      heartbeatTimers: new Map(),
      persistTimer: null,
    };
    sessions.set(session.sessionId, session);
    return session;
  }

  if (incoming.lastActivityAt > (Number(existing.lastActivityAt) || 0)) {
    existing.presentationId = incoming.presentationId;
    existing.state = incoming.state;
    existing.controlEnabled = incoming.controlEnabled;
    existing.followCodes = incoming.followCodes;
    existing.followCodesCreatedAt = incoming.followCodesCreatedAt;
    existing.createdAt = incoming.createdAt;
    existing.lastActivityAt = incoming.lastActivityAt;
  }
  return existing;
}

const SESSION_COLUMNS = [
  'session_id',
  'presentation_id',
  'state',
  'control_enabled',
  'follow_codes',
  'follow_codes_created_at',
  'created_at',
  'last_activity_at',
];

/**
 * Write a session to the table. Fire-and-forget from the debounce; callers that
 * need the write to land (session creation) await it.
 * @param {object} s - Live session.
 * @returns {Promise<void>}
 */
export async function persistSession(s) {
  if (!s?.sessionId || !s?.presentationId) return;
  const data = serializeSession(s);
  await withDbGuard(undefined, async (db) => {
    const values = {
      session_id: data.sessionId,
      presentation_id: data.presentationId,
      state: JSON.stringify(data.state ?? {}),
      control_enabled: data.controlEnabled,
      follow_codes: JSON.stringify(data.followCodes ?? {}),
      follow_codes_created_at: data.followCodesCreatedAt
        ? new Date(data.followCodesCreatedAt)
        : null,
      created_at: new Date(data.createdAt),
      last_activity_at: new Date(data.lastActivityAt),
    };
    await db
      .insertInto('present_sessions')
      .values(values)
      .onConflict((oc) =>
        oc.column('session_id').doUpdateSet({
          state: values.state,
          control_enabled: values.control_enabled,
          follow_codes: values.follow_codes,
          follow_codes_created_at: values.follow_codes_created_at,
          last_activity_at: values.last_activity_at,
        })
      )
      .execute();
  });
}

/**
 * Persist after a short debounce, coalescing a burst of state pushes into one
 * write. Unchanged in shape from the file-backed version — only the write
 * underneath is different.
 * @param {object} s - Live session.
 * @returns {void}
 */
export function schedulePersist(s) {
  if (!s) return;
  if (s.persistTimer) clearTimeout(s.persistTimer);
  s.persistTimer = setTimeout(() => {
    s.persistTimer = null;
    persistSession(s).catch(() => {});
  }, PERSIST_DEBOUNCE_MS);
  s.persistTimer.unref?.();
}

/**
 * Look a session up by id, adopting or refreshing it from the table.
 * @param {string} sessionId
 * @returns {Promise<object|null>} The live session, or null if unknown/expired.
 */
export async function hydrateSession(sessionId) {
  const id = String(sessionId || '');
  if (!id) return null;

  const row = await withDbGuard(null, async (db) =>
    db
      .selectFrom('present_sessions')
      .select(SESSION_COLUMNS)
      .where('session_id', '=', id)
      .executeTakeFirst()
  );

  // No row: either the database is unavailable, or the session was created in
  // this process microseconds ago and the debounced write has not landed yet.
  // The local copy stays authoritative in both cases.
  if (!row) return sessions.get(id) || null;
  return mergeRow(row);
}

/**
 * Adopt or refresh every stored session for one presentation, so a lookup by
 * deck sees sessions other processes own.
 * @param {string} presentationId
 * @returns {Promise<void>}
 */
export async function hydrateSessionsForPresentation(presentationId) {
  const pid = String(presentationId || '').trim();
  if (!pid) return;

  const rows = await withDbGuard([], async (db) =>
    db
      .selectFrom('present_sessions')
      .select(SESSION_COLUMNS)
      .where('presentation_id', '=', pid)
      .execute()
  );

  for (const row of rows) mergeRow(row);
}

/**
 * Remove a session's row. Interactions, questions and feedback are foreign-keyed
 * to `session_id` with ON DELETE CASCADE, so once those domains move to the
 * database too (PR 5) this one statement takes their rows with it.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function deletePersistedSession(sessionId) {
  const id = String(sessionId || '');
  if (!id) return;
  await withDbGuard(undefined, async (db) => {
    await db.deleteFrom('present_sessions').where('session_id', '=', id).execute();
  });
}

/**
 * Delete every session that is past its idle TTL — the sweep half of the
 * cleanup, for rows this process never held in memory (a session whose worker
 * died, or one that outlived a redeploy). The in-memory timer in `sessions.js`
 * handles the sessions this process *does* hold, because those also need their
 * SSE clients closed.
 *
 * @returns {Promise<number>} How many sessions were removed.
 */
export async function sweepExpiredSessions() {
  // TTL_MS stays the single source of the window; only the comparison lives in
  // SQL. Same shape as the sandbox sweep (utils/sandbox-cleanup.js).
  const cutoff = new Date(Date.now() - TTL_MS).toISOString();
  return withDbGuard(0, async (db) => {
    const result = await db
      .deleteFrom('present_sessions')
      .where('last_activity_at', '<=', cutoff)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0);
  });
}
