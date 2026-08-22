/**
 * Audience Q&A storage (session-scoped), on PostgreSQL.
 *
 * One row per question in `questions`, foreign-keyed to `present_sessions`.
 * There is no separate "questions session" any more: the file version kept one
 * per session with its own `createdAt`/`lastActivityAt` and its own 24h TTL
 * timer, which was a second lifetime for a thing that already had one. The live
 * session is the lifetime — the cascade takes the questions with it when the
 * session closes or the sweep in `jobs/live-session-cleanup.js` collects it.
 *
 * What stays in this process is the SSE registry: the response streams attached
 * here and their heartbeat timers. Those are sockets, so they cannot be shared
 * by a table. As with live sessions, that means fan-out is process-local — a
 * question asked on worker A does not push to a follower attached to worker B
 * until that client re-reads. The list itself is correct everywhere, which the
 * file version could not manage: it only ever showed the questions the process
 * that held the session had loaded.
 *
 * Upvotes are not stored as a number. `voters` is the set of device ids that
 * voted, so the count is `cardinality(voters)` — one source of truth, and the
 * "one vote per device" rule is a set membership test rather than two fields
 * that have to be kept in step.
 */

import { sql } from 'kysely';

import { normalizeLang } from '../utils/i18n.js';
import { sseWrite } from '../utils/sse.js';
import { toStorageContext } from './scope.js';
import { withDbGuard } from './utils/db-guard.js';
import { UUID_RE } from '../utils/uuid.js';
import { fireAndForget } from '../utils/fire-and-forget.js';

// Note: questions are not auto-translated (explicit translation may be added later).

/** Author/voter ids come from a client-controlled cookie; clamp to the column. */
const MAX_AUTHOR_ID_LENGTH = 100;

/**
 * SSE clients per session — the half of a session that cannot be a row.
 * @type {Map<string, { clients: Set<any> }>}
 */
const sseSessions = new Map();

/** Statuses a question is still visible and actionable in. */
const ACTIVE_STATUSES = ['active', 'promoted'];

// Question ids reach us straight from a URL path; see utils/uuid.js for why
// a non-uuid must short-circuit to "no such question" before the query.

function now() {
  return Date.now();
}

/**
 * @param {*} v
 * @returns {string}
 */
function normalizeActorId(v) {
  return String(v || '')
    .trim()
    .slice(0, MAX_AUTHOR_ID_LENGTH);
}

function normalizeText(v) {
  const s = String(v || '').trim();
  // Keep it short to avoid abuse / runaway storage.
  return s.slice(0, 600);
}

function normalizeName(v) {
  const s = String(v || '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, 60);
}

/**
 * Epoch millis from a timestamptz column.
 * @param {*} value
 * @returns {number}
 */
function toMillis(value) {
  if (!value) return 0;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

const QUESTION_COLUMNS = [
  'id',
  'session_id',
  'author_id',
  'author_name',
  'text',
  'original_lang',
  'texts',
  'voters',
  'status',
  'promoted_at',
  'promoted_slide_id',
  'promoted_by',
  'created_at',
];

/**
 * @typedef {object} QuestionRecord
 * @property {string} id
 * @property {string} authorId
 * @property {string} authorName
 * @property {string} text - The question as asked.
 * @property {string|null} originalLang
 * @property {Object<string, string>} texts - Per-language texts, keyed by lang.
 * @property {string[]} voters
 * @property {number} upvotes - Derived: `voters.length`.
 * @property {string} status
 * @property {number} promotedAt
 * @property {string} promotedSlideId
 * @property {number} createdAt
 */

/**
 * @param {object} row
 * @returns {QuestionRecord}
 */
function rowToQuestion(row) {
  const voters = Array.isArray(row.voters) ? row.voters.map(String) : [];
  return {
    id: String(row.id),
    authorId: String(row.author_id || ''),
    authorName: String(row.author_name || ''),
    text: String(row.text || ''),
    originalLang: normalizeLang(row.original_lang) || null,
    texts: row.texts && typeof row.texts === 'object' ? row.texts : {},
    voters,
    upvotes: voters.length,
    status: String(row.status || 'active'),
    promotedAt: toMillis(row.promoted_at),
    promotedSlideId: String(row.promoted_slide_id || ''),
    createdAt: toMillis(row.created_at) || now(),
  };
}

/**
 * The audience-facing shape of a question.
 *
 * @param {QuestionRecord} q
 * @returns {object}
 */
function publicQuestion(q) {
  const texts = q.texts && typeof q.texts === 'object' ? q.texts : {};
  return {
    id: q.id,
    // Back-compat: `text` is the original text.
    text: q.text,
    createdAt: q.createdAt,
    upvotes: q.upvotes,
    authorName: q.authorName.trim(),
    status: q.status,
    promoted: {
      slideId: q.promotedSlideId,
      promotedAt: q.promotedAt,
    },
    original: {
      lang: q.originalLang,
      text: q.text,
    },
    texts: {
      nl: typeof texts.nl === 'string' ? texts.nl : '',
      'en-GB': typeof texts['en-GB'] === 'string' ? texts['en-GB'] : '',
    },
  };
}

/**
 * Fan a payload out to the SSE clients this process holds for a session.
 *
 * @param {string} sessionId
 * @param {string} event
 * @param {*} data
 * @returns {void}
 */
function broadcast(sessionId, event, data) {
  const reg = sseSessions.get(String(sessionId || ''));
  if (!reg) return;
  // Serialize once for all clients; sseWrite passes strings through as-is.
  const payload =
    data == null || typeof data === 'string' ? data : JSON.stringify(data);
  for (const res of Array.from(reg.clients)) {
    try {
      sseWrite(res, { event, data: payload });
    } catch {
      try {
        reg.clients.delete(res);
      } catch {}
    }
  }
}

/**
 * Push the current list to every attached client. Fire-and-forget: a failed
 * broadcast must never fail the mutation that triggered it.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @returns {void}
 */
function broadcastQuestions(scope, sessionId) {
  if (!sseSessions.has(String(sessionId || ''))) return;
  fireAndForget(
    listQuestions(scope, sessionId).then((questions) =>
      broadcast(sessionId, 'questions', { questions: questions || [] }),
    ),
    'questions broadcast',
  );
}

/**
 * Read one question, by session and id.
 *
 * Q&A is session-capability data: the audience asks and votes without a
 * session login, so the audience-reachable functions here accept a
 * cross-organization scope (see routes/api/follow/helpers.js). The moderator
 * actions (`removeQuestion`, `promoteQuestion`) require an organization-scoped
 * scope.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {string} questionId
 * @returns {Promise<QuestionRecord|null>}
 */
export async function getQuestion(scope, sessionId, questionId) {
  toStorageContext(scope, 'getQuestion', {}, { allowCrossOrganization: true });
  const sid = String(sessionId || '').trim();
  const qid = String(questionId || '').trim();
  if (!sid || !UUID_RE.test(qid)) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('questions')
      .select(QUESTION_COLUMNS)
      .where('session_id', '=', sid)
      .where('id', '=', qid)
      .executeTakeFirst();
    return row ? rowToQuestion(row) : null;
  });
}

/**
 * The visible, ranked question list for a session: promoted first, then by
 * upvotes, then oldest first.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @returns {Promise<Array<object>|null>} Null when the session id is empty.
 */
export async function listQuestions(scope, sessionId) {
  toStorageContext(
    scope,
    'listQuestions',
    {},
    { allowCrossOrganization: true },
  );
  const sid = String(sessionId || '').trim();
  if (!sid) return null;

  return withDbGuard([], async (db) => {
    const rows = await db
      .selectFrom('questions')
      .select(QUESTION_COLUMNS)
      .where('session_id', '=', sid)
      .where('status', 'in', ACTIVE_STATUSES)
      .orderBy(sql`status = 'promoted'`, 'desc')
      .orderBy(sql`cardinality(voters)`, 'desc')
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map((row) => publicQuestion(rowToQuestion(row)));
  });
}

/**
 * Ask a question.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<{ok: true, question: object}|{ok: false, reason: string}>}
 */
export async function createQuestion(
  scope,
  sessionId,
  { authorId, authorName, text, originalLang } = {},
) {
  toStorageContext(
    scope,
    'createQuestion',
    {},
    { allowCrossOrganization: true },
  );
  const sid = String(sessionId || '').trim();
  const a = normalizeActorId(authorId);
  const n = normalizeName(authorName);
  const t = normalizeText(text);
  const from = normalizeLang(originalLang) || null;
  if (!sid) return { ok: false, reason: 'not_found' };
  if (!a) return { ok: false, reason: 'missing_author' };
  if (!t) return { ok: false, reason: 'missing_text' };

  const row = await withDbGuard(null, async (db) => {
    try {
      return await db
        .insertInto('questions')
        .values({
          session_id: sid,
          author_id: a,
          author_name: n,
          text: t,
          original_lang: from,
          texts: JSON.stringify(from ? { [from]: t } : {}),
          voters: [],
          status: 'active',
        })
        .returning(QUESTION_COLUMNS)
        .executeTakeFirst();
    } catch (err) {
      // 23503: no such live session. The route resolved one, so this is the
      // narrow race where it ended in between.
      if (String(err?.code || '') === '23503') return null;
      throw err;
    }
  });
  if (!row) return { ok: false, reason: 'not_found' };

  broadcastQuestions(scope, sid);
  return { ok: true, question: publicQuestion(rowToQuestion(row)) };
}

/**
 * Upvote a question, once per device.
 *
 * The append is guarded in SQL rather than by a read-then-write, so two devices
 * (or two processes) racing cannot both append and neither can double-count.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<{ok: true, upvotes: number}|{ok: false, reason: string}>}
 */
export async function upvoteQuestion(
  scope,
  sessionId,
  { questionId, voterId } = {},
) {
  toStorageContext(
    scope,
    'upvoteQuestion',
    {},
    { allowCrossOrganization: true },
  );
  const sid = String(sessionId || '').trim();
  const qid = String(questionId || '').trim();
  const vid = normalizeActorId(voterId);
  if (!qid) return { ok: false, reason: 'missing_question_id' };
  if (!vid) return { ok: false, reason: 'missing_voter' };

  const q = await getQuestion(scope, sid, qid);
  if (!q) return { ok: false, reason: 'not_found' };
  if (q.status === 'promoted') return { ok: false, reason: 'locked' };
  if (!ACTIVE_STATUSES.includes(q.status))
    return { ok: false, reason: 'inactive' };
  if (q.authorId === vid) return { ok: false, reason: 'own_question' };

  const upvotes = await withDbGuard(null, async (db) => {
    const { rows } = await sql`
      UPDATE questions
      SET voters = array_append(voters, ${vid})
      WHERE id = ${qid}
        AND session_id = ${sid}
        AND status = 'active'
        AND NOT (voters @> ARRAY[${vid}]::text[])
      RETURNING cardinality(voters) AS upvotes
    `.execute(db);
    return rows?.length ? Number(rows[0].upvotes || 0) : null;
  });
  if (upvotes == null) return { ok: false, reason: 'already_voted' };

  broadcastQuestions(scope, sid);
  return { ok: true, upvotes };
}

/**
 * Transition a question to a terminal status, if it is still actionable.
 *
 * @param {string} sessionId
 * @param {string} questionId
 * @param {Record<string, any>} set - Columns to write.
 * @returns {Promise<boolean>} Whether a row changed.
 */
async function transitionQuestion(sessionId, questionId, set) {
  return withDbGuard(false, async (db) => {
    const row = await db
      .updateTable('questions')
      .set(set)
      .where('id', '=', questionId)
      .where('session_id', '=', sessionId)
      // 'promoted' is a lock: it is not cancellable, removable or re-promotable.
      .where('status', '=', 'active')
      .returning('id')
      .executeTakeFirst();
    return !!row;
  });
}

/**
 * Withdraw your own question.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function cancelQuestion(
  scope,
  sessionId,
  { questionId, authorId } = {},
) {
  toStorageContext(
    scope,
    'cancelQuestion',
    {},
    { allowCrossOrganization: true },
  );
  const sid = String(sessionId || '').trim();
  const qid = String(questionId || '').trim();
  const aid = normalizeActorId(authorId);
  if (!qid) return { ok: false, reason: 'missing_question_id' };
  if (!aid) return { ok: false, reason: 'missing_author' };

  const q = await getQuestion(scope, sid, qid);
  if (!q) return { ok: false, reason: 'not_found' };
  if (q.status === 'promoted') return { ok: false, reason: 'locked' };
  if (q.authorId !== aid) return { ok: false, reason: 'forbidden' };
  if (!ACTIVE_STATUSES.includes(q.status))
    return { ok: false, reason: 'inactive' };

  const changed = await transitionQuestion(sid, qid, {
    status: 'cancelled',
    cancelled_at: new Date(),
  });
  if (!changed) return { ok: false, reason: 'inactive' };

  broadcastQuestions(scope, sid);
  return { ok: true };
}

/**
 * Moderator removal.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function removeQuestion(
  scope,
  sessionId,
  { questionId, removedBy } = {},
) {
  toStorageContext(scope, 'removeQuestion');
  const sid = String(sessionId || '').trim();
  const qid = String(questionId || '').trim();
  if (!qid) return { ok: false, reason: 'missing_question_id' };

  const q = await getQuestion(scope, sid, qid);
  if (!q) return { ok: false, reason: 'not_found' };
  if (q.status === 'promoted') return { ok: false, reason: 'locked' };
  if (!ACTIVE_STATUSES.includes(q.status))
    return { ok: false, reason: 'inactive' };

  const changed = await transitionQuestion(sid, qid, {
    status: 'removed',
    removed_at: new Date(),
    removed_by: String(removedBy || '')
      .trim()
      .slice(0, 320),
  });
  if (!changed) return { ok: false, reason: 'inactive' };

  broadcastQuestions(scope, sid);
  return { ok: true };
}

/**
 * Promote a question onto a slide. Promoting locks it: no more votes, no
 * cancellation, no removal.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} [opts]
 * @returns {Promise<{ok: boolean, already?: boolean, reason?: string}>}
 */
export async function promoteQuestion(
  scope,
  sessionId,
  { questionId, slideId, promotedBy } = {},
) {
  toStorageContext(scope, 'promoteQuestion');
  const sid = String(sessionId || '').trim();
  const qid = String(questionId || '').trim();
  if (!qid) return { ok: false, reason: 'missing_question_id' };

  const q = await getQuestion(scope, sid, qid);
  if (!q) return { ok: false, reason: 'not_found' };
  if (q.status === 'promoted') return { ok: true, already: true };
  if (!ACTIVE_STATUSES.includes(q.status))
    return { ok: false, reason: 'inactive' };

  const changed = await transitionQuestion(sid, qid, {
    status: 'promoted',
    promoted_at: new Date(),
    promoted_slide_id: String(slideId || '').trim(),
    promoted_by: String(promotedBy || '')
      .trim()
      .slice(0, 320),
  });
  if (!changed) return { ok: false, reason: 'inactive' };

  broadcastQuestions(scope, sid);
  return { ok: true };
}

/**
 * Attach an SSE stream to a session's question feed, send the current list and
 * start heartbeats.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<(() => void)|null>} A detach function, or null for an empty id.
 */
export async function attachQuestionsSseClient(scope, sessionId, res) {
  toStorageContext(
    scope,
    'attachQuestionsSseClient',
    {},
    { allowCrossOrganization: true },
  );
  const sid = String(sessionId || '').trim();
  if (!sid) return null;

  let reg = sseSessions.get(sid);
  if (!reg) {
    reg = { clients: new Set() };
    sseSessions.set(sid, reg);
  }
  reg.clients.add(res);

  // Initial snapshot
  const questions = await listQuestions(scope, sid);
  sseWrite(res, { event: 'questions', data: { questions: questions || [] } });

  // No heartbeat here: openSseStream() owns the per-connection heartbeat.
  const detach = () => {
    try {
      reg.clients.delete(res);
    } catch {}
    if (!reg.clients.size) sseSessions.delete(sid);
  };

  res.on?.('close', detach);
  res.on?.('finish', detach);
  return detach;
}

/**
 * Close every question stream this process holds for a session.
 *
 * Called from `live-sessions/close.js`: the question rows go with the
 * session through the foreign key, and the sockets have to go with them or
 * followers sit on a feed whose data no longer exists.
 *
 * @param {string} sessionId
 * @param {string} [reason]
 * @returns {boolean} Whether any client was attached here.
 */
export function closeQuestionsClients(sessionId, reason = 'closed') {
  const sid = String(sessionId || '').trim();
  const reg = sseSessions.get(sid);
  if (!reg) return false;
  for (const res of Array.from(reg.clients)) {
    try {
      sseWrite(res, { event: 'close', data: { reason } });
    } catch {}
    try {
      res.end?.();
    } catch {}
  }
  sseSessions.delete(sid);
  return true;
}
