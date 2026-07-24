import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeLang } from '../utils/i18n.js';
import { sseComment, sseWrite } from '../utils/sse.js';
import { writeJsonAtomic } from './io.js';
import { dataDir } from '../config/storage-paths.js';

const TTL_MS = 24 * 60 * 60 * 1000; // ~1 day
const HEARTBEAT_MS = 15 * 1000;
// Note: questions are not auto-translated (explicit translation may be added later).

/** @type {Map<string, any>} */
const sessions = new Map(); // sessionId -> session object
const loadedRoots = new Set();

let cleanupTimerStarted = false;
function ensureCleanupTimer() {
  if (cleanupTimerStarted) return;
  cleanupTimerStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
      if (!s) {
        sessions.delete(id);
        continue;
      }
      const last = Number(s.lastActivityAt || 0) || 0;
      if (now - last <= TTL_MS) continue;
      try {
        closeQuestionsSession(id, 'expired');
      } catch {
        sessions.delete(id);
      }
    }
  }, 60 * 1000).unref?.();
}

function sessionsDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'questions');
}

function sessionFile(repoRoot, sessionId) {
  return path.join(sessionsDir(repoRoot), `${sessionId}.json`);
}

function isExpired(s) {
  const last = Number(s?.lastActivityAt || 0) || 0;
  if (!last) return true;
  return Date.now() - last > TTL_MS;
}

function serializeSession(s) {
  return {
    sessionId: s.sessionId,
    presentationId: s.presentationId,
    createdAt: Number(s.createdAt || 0) || Date.now(),
    lastActivityAt: Number(s.lastActivityAt || 0) || Date.now(),
    questions: Array.isArray(s.questions)
      ? s.questions.map((q) => ({
          id: String(q?.id || ''),
          text: String(q?.text || ''),
          originalText: String(q?.originalText || ''),
          originalLang: String(q?.originalLang || ''),
          texts: q?.texts && typeof q.texts === 'object' ? q.texts : {},
          translatedAt: Number(q?.translatedAt || 0) || 0,
          translatedFrom: String(q?.translatedFrom || ''),
          createdAt: Number(q?.createdAt || 0) || Date.now(),
          authorId: String(q?.authorId || ''),
          authorName: String(q?.authorName || ''),
          upvotes: Math.max(0, Number(q?.upvotes || 0) || 0),
          voters: Array.isArray(q?.voters) ? q.voters.map(String) : [],
          status: String(q?.status || 'active'),
          promotedAt: Number(q?.promotedAt || 0) || 0,
          promotedSlideId: String(q?.promotedSlideId || ''),
          promotedBy: String(q?.promotedBy || ''),
          removedAt: Number(q?.removedAt || 0) || 0,
          removedBy: String(q?.removedBy || ''),
          cancelledAt: Number(q?.cancelledAt || 0) || 0,
        }))
      : [],
  };
}

async function writeSessionToDisk(s) {
  const repoRoot = s?.repoRoot;
  if (!repoRoot || !s?.sessionId) return;
  await writeJsonAtomic(sessionFile(repoRoot, s.sessionId), serializeSession(s));
}

function schedulePersist(s) {
  if (!s) return;
  if (s.persistTimer) clearTimeout(s.persistTimer);
  s.persistTimer = setTimeout(() => {
    s.persistTimer = null;
    writeSessionToDisk(s).catch(() => {});
  }, 600);
  s.persistTimer.unref?.();
}

async function loadSessionsFromDisk(repoRoot) {
  const root = String(repoRoot || '');
  if (!root || loadedRoots.has(root)) return;
  loadedRoots.add(root);

  const dir = sessionsDir(root);
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(dir, f);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const data = JSON.parse(raw);
      if (!data?.sessionId || !data?.presentationId) continue;
      const s = {
        sessionId: String(data.sessionId),
        presentationId: String(data.presentationId),
        createdAt: Number(data.createdAt || 0) || Date.now(),
        lastActivityAt: Number(data.lastActivityAt || 0) || Date.now(),
        questions: Array.isArray(data.questions) ? data.questions : [],
        repoRoot: root,
        clients: new Set(),
        heartbeatTimers: new Map(),
        persistTimer: null,
      };
      if (isExpired(s)) {
        try {
          await fs.unlink(full);
        } catch {}
        continue;
      }
      sessions.set(s.sessionId, s);
    } catch {
      // ignore bad files
    }
  }
}

function now() {
  return Date.now();
}

function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function normalizeText(v) {
  const s = String(v || '').trim();
  // Keep it short to avoid abuse / runaway storage.
  return s.slice(0, 600);
}

function normalizeName(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 60);
}

function isActiveQuestion(q) {
  if (!q || typeof q !== 'object') return false;
  const st = String(q.status || 'active');
  return st === 'active' || st === 'promoted';
}

function publicQuestion(q) {
  const originalLang = normalizeLang(q?.originalLang) || null;
  const texts = q?.texts && typeof q.texts === 'object' ? q.texts : {};
  const textNl = typeof texts?.nl === 'string' ? texts.nl : '';
  const textEn = typeof texts?.['en-GB'] === 'string' ? texts['en-GB'] : '';
  const originalText =
    typeof q?.originalText === 'string' && q.originalText.trim()
      ? q.originalText
      : typeof q?.text === 'string'
      ? q.text
      : '';
  return {
    id: String(q?.id || ''),
    // Back-compat: `text` is the original text.
    text: String(originalText || ''),
    createdAt: Number(q?.createdAt || 0) || 0,
    upvotes: Math.max(0, Number(q?.upvotes || 0) || 0),
    authorName: String(q?.authorName || '').trim() || '',
    status: String(q?.status || 'active'),
    promoted: {
      slideId: String(q?.promotedSlideId || ''),
      promotedAt: Number(q?.promotedAt || 0) || 0,
    },
    original: {
      lang: originalLang,
      text: String(originalText || ''),
    },
    texts: {
      nl: String(textNl || ''),
      'en-GB': String(textEn || ''),
    },
    translatedAt: Number(q?.translatedAt || 0) || 0,
    translatedFrom: normalizeLang(q?.translatedFrom) || null,
  };
}

function rankQuestions(list) {
  const arr = Array.isArray(list) ? list : [];
  arr.sort((a, b) => {
    const ap = String(a?.status || '') === 'promoted';
    const bp = String(b?.status || '') === 'promoted';
    if (ap !== bp) return ap ? -1 : 1;
    const au = Math.max(0, Number(a?.upvotes || 0) || 0);
    const bu = Math.max(0, Number(b?.upvotes || 0) || 0);
    if (bu !== au) return bu - au;
    const at = Number(a?.createdAt || 0) || 0;
    const bt = Number(b?.createdAt || 0) || 0;
    return at - bt;
  });
  return arr;
}

async function broadcast(repoRoot, sessionId, event, data) {
  const s = await touchQuestionsSession(repoRoot, sessionId);
  if (!s) return false;
  // Serialize once for all clients; sseWrite passes strings through as-is.
  const payload =
    data == null || typeof data === 'string' ? data : JSON.stringify(data);
  for (const res of Array.from(s.clients)) {
    try {
      sseWrite(res, { event, data: payload });
    } catch {
      try {
        s.clients.delete(res);
      } catch {}
    }
  }
  return true;
}

export async function getQuestionsSession(repoRoot, sessionId) {
  await loadSessionsFromDisk(repoRoot);
  return sessions.get(String(sessionId || '')) || null;
}

export async function ensureQuestionsSession(repoRoot, sessionId, { presentationId } = {}) {
  ensureCleanupTimer();
  await loadSessionsFromDisk(repoRoot);
  const sid = String(sessionId || '').trim();
  const pid = String(presentationId || '').trim();
  if (!sid || !pid) return null;

  const existing = sessions.get(sid) || null;
  if (existing) {
    existing.presentationId = pid;
    existing.lastActivityAt = now();
    schedulePersist(existing);
    return existing;
  }

  const s = {
    sessionId: sid,
    presentationId: pid,
    createdAt: now(),
    lastActivityAt: now(),
    questions: [],
    repoRoot,
    clients: new Set(),
    heartbeatTimers: new Map(),
    persistTimer: null,
  };
  sessions.set(sid, s);
  schedulePersist(s);
  return s;
}

export async function touchQuestionsSession(repoRoot, sessionId) {
  const s = await getQuestionsSession(repoRoot, sessionId);
  if (!s) return null;
  s.lastActivityAt = now();
  schedulePersist(s);
  return s;
}

export async function listQuestions(repoRoot, sessionId) {
  const s = await touchQuestionsSession(repoRoot, sessionId);
  if (!s) return null;
  const visible = rankQuestions(
    (Array.isArray(s.questions) ? s.questions : []).filter(isActiveQuestion)
  );
  return visible.map(publicQuestion);
}

export async function createQuestion(
  repoRoot,
  sessionId,
  { authorId, authorName, text, originalLang } = {}
) {
  const s = await touchQuestionsSession(repoRoot, sessionId);
  if (!s) return { ok: false, reason: 'not_found' };
  const a = String(authorId || '').trim();
  const n = normalizeName(authorName);
  const t = normalizeText(text);
  const from = normalizeLang(originalLang) || null;
  if (!a) return { ok: false, reason: 'missing_author' };
  if (!t) return { ok: false, reason: 'missing_text' };

  const q = {
    id: newId(),
    text: t,
    originalText: t,
    originalLang: from || '',
    texts: {
      ...(from ? { [from]: t } : {}),
    },
    translatedAt: 0,
    translatedFrom: '',
    createdAt: now(),
    authorId: a,
    authorName: n,
    upvotes: 0,
    voters: [],
    status: 'active',
    promotedAt: 0,
    promotedSlideId: '',
    promotedBy: '',
    removedAt: 0,
    removedBy: '',
    cancelledAt: 0,
  };
  s.questions = Array.isArray(s.questions) ? s.questions : [];
  s.questions.push(q);

  schedulePersist(s);
  broadcast(repoRoot, sessionId, 'questions', {
    questions: await listQuestions(repoRoot, sessionId),
  }).catch(() => {});
  return { ok: true, question: publicQuestion(q) };
}

export async function upvoteQuestion(repoRoot, sessionId, { questionId, voterId } = {}) {
  const s = await touchQuestionsSession(repoRoot, sessionId);
  if (!s) return { ok: false, reason: 'not_found' };
  const qid = String(questionId || '').trim();
  const vid = String(voterId || '').trim();
  if (!qid) return { ok: false, reason: 'missing_questionId' };
  if (!vid) return { ok: false, reason: 'missing_voter' };

  const q = (Array.isArray(s.questions) ? s.questions : []).find((x) => String(x?.id || '') === qid) || null;
  if (!q) return { ok: false, reason: 'not_found' };
  if (String(q.status || '') === 'promoted') return { ok: false, reason: 'locked' };
  if (!isActiveQuestion(q)) return { ok: false, reason: 'inactive' };
  if (String(q.authorId || '') === vid) return { ok: false, reason: 'own_question' };

  q.voters = Array.isArray(q.voters) ? q.voters : [];
  if (q.voters.includes(vid)) return { ok: false, reason: 'already_voted' };
  q.voters.push(vid);
  q.upvotes = Math.max(0, Number(q.upvotes || 0) || 0) + 1;
  schedulePersist(s);
  broadcast(repoRoot, sessionId, 'questions', { questions: await listQuestions(repoRoot, sessionId) }).catch(() => {});
  return { ok: true, upvotes: q.upvotes };
}

export async function cancelQuestion(repoRoot, sessionId, { questionId, authorId } = {}) {
  const s = await touchQuestionsSession(repoRoot, sessionId);
  if (!s) return { ok: false, reason: 'not_found' };
  const qid = String(questionId || '').trim();
  const aid = String(authorId || '').trim();
  if (!qid) return { ok: false, reason: 'missing_questionId' };
  if (!aid) return { ok: false, reason: 'missing_author' };

  const q = (Array.isArray(s.questions) ? s.questions : []).find((x) => String(x?.id || '') === qid) || null;
  if (!q) return { ok: false, reason: 'not_found' };
  if (String(q.status || '') === 'promoted') return { ok: false, reason: 'locked' };
  if (String(q.authorId || '') !== aid) return { ok: false, reason: 'forbidden' };
  if (!isActiveQuestion(q)) return { ok: false, reason: 'inactive' };

  q.status = 'cancelled';
  q.cancelledAt = now();
  schedulePersist(s);
  broadcast(repoRoot, sessionId, 'questions', { questions: await listQuestions(repoRoot, sessionId) }).catch(() => {});
  return { ok: true };
}

export async function removeQuestion(repoRoot, sessionId, { questionId, removedBy } = {}) {
  const s = await touchQuestionsSession(repoRoot, sessionId);
  if (!s) return { ok: false, reason: 'not_found' };
  const qid = String(questionId || '').trim();
  if (!qid) return { ok: false, reason: 'missing_questionId' };

  const q = (Array.isArray(s.questions) ? s.questions : []).find((x) => String(x?.id || '') === qid) || null;
  if (!q) return { ok: false, reason: 'not_found' };
  if (String(q.status || '') === 'promoted') return { ok: false, reason: 'locked' };
  if (!isActiveQuestion(q)) return { ok: false, reason: 'inactive' };

  q.status = 'removed';
  q.removedAt = now();
  q.removedBy = String(removedBy || '').trim();
  schedulePersist(s);
  broadcast(repoRoot, sessionId, 'questions', { questions: await listQuestions(repoRoot, sessionId) }).catch(() => {});
  return { ok: true };
}

export async function promoteQuestion(
  repoRoot,
  sessionId,
  { questionId, slideId, promotedBy } = {}
) {
  const s = await touchQuestionsSession(repoRoot, sessionId);
  if (!s) return { ok: false, reason: 'not_found' };
  const qid = String(questionId || '').trim();
  if (!qid) return { ok: false, reason: 'missing_questionId' };
  const q =
    (Array.isArray(s.questions) ? s.questions : []).find(
      (x) => String(x?.id || '') === qid
    ) || null;
  if (!q) return { ok: false, reason: 'not_found' };
  if (!isActiveQuestion(q)) return { ok: false, reason: 'inactive' };
  if (String(q.status || '') === 'promoted') return { ok: true, already: true };

  q.status = 'promoted';
  q.promotedAt = now();
  q.promotedSlideId = String(slideId || '').trim();
  q.promotedBy = String(promotedBy || '').trim();
  schedulePersist(s);
  broadcast(repoRoot, sessionId, 'questions', {
    questions: await listQuestions(repoRoot, sessionId),
  }).catch(() => {});
  return { ok: true };
}

export async function attachQuestionsSseClient(repoRoot, sessionId, res) {
  const s = await touchQuestionsSession(repoRoot, sessionId);
  if (!s) return null;

  s.clients.add(res);

  // Initial snapshot
  const questions = await listQuestions(repoRoot, sessionId);
  sseWrite(res, { event: 'questions', data: { questions: questions || [] } });

  // Heartbeats
  const tid = setInterval(() => {
    sseComment(res, 'heartbeat');
  }, HEARTBEAT_MS);
  s.heartbeatTimers.set(res, tid);

  const detach = () => {
    try {
      clearInterval(tid);
    } catch {}
    try {
      s.heartbeatTimers.delete(res);
    } catch {}
    try {
      s.clients.delete(res);
    } catch {}
  };

  res.on?.('close', detach);
  res.on?.('finish', detach);
  return detach;
}

export function closeQuestionsSession(sessionId, reason = 'closed') {
  const s = sessions.get(String(sessionId || '')) || null;
  if (!s) return false;
  for (const res of Array.from(s.clients)) {
    try {
      sseWrite(res, { event: 'close', data: { reason } });
    } catch {}
    try {
      res.end?.();
    } catch {}
  }
  for (const tid of s.heartbeatTimers.values()) {
    try {
      clearInterval(tid);
    } catch {}
  }
  if (s.persistTimer) {
    try {
      clearTimeout(s.persistTimer);
    } catch {}
  }
  sessions.delete(sessionId);
  if (s.repoRoot) {
    fs.unlink(sessionFile(s.repoRoot, sessionId)).catch(() => {});
  }
  return true;
}
