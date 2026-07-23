import fs from 'node:fs/promises';
import path from 'node:path';
import { notifyPresentSessionInteractionState } from './present-sessions.js';
import { writeJsonAtomic } from './io.js';
import { dataDir } from '../config/storage-paths.js';
import { maybeFireInteractionWebhook } from '../utils/webhooks.js';

/**
 * Session-scoped feedback storage (per slide, per device).
 *
 * - Not shown on slides (only collected via follow UI)
 * - Presenter can export as CSV/JSON
 */

const TTL_MS = 24 * 60 * 60 * 1000; // ~1 day (matches present-sessions + interactions)

/** @type {Map<string, any>} */
const sessions = new Map(); // sessionId -> session

function feedbackDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'feedback');
}

function sessionFile(repoRoot, sessionId) {
  return path.join(feedbackDir(repoRoot), `${sessionId}.json`);
}

function now() {
  return Date.now();
}

function safeObject(v) {
  return v && typeof v === 'object' ? v : {};
}

function safeString(v) {
  return typeof v === 'string' ? v : '';
}

function serializeSession(s) {
  const slides = {};
  for (const [slideId, st] of s.slides.entries()) {
    const entriesByDevice = {};
    for (const [deviceId, it] of st.entriesByDevice.entries()) {
      entriesByDevice[deviceId] = {
        text: safeString(it?.text),
        createdAt: Number(it?.createdAt || 0) || now(),
        updatedAt: Number(it?.updatedAt || 0) || now(),
      };
    }
    slides[slideId] = {
      status: st.status,
      entriesByDevice,
      updatedAt: Number(st.updatedAt || 0) || now(),
      createdAt: Number(st.createdAt || 0) || now(),
    };
  }
  return {
    sessionId: s.sessionId,
    presentationId: s.presentationId,
    slides,
    createdAt: Number(s.createdAt || 0) || now(),
    lastActivityAt: Number(s.lastActivityAt || 0) || now(),
  };
}

async function writeSessionToDisk(s) {
  const repoRoot = s?.repoRoot;
  if (!repoRoot || !s?.sessionId) return;
  await writeJsonAtomic(sessionFile(repoRoot, s.sessionId), serializeSession(s));
}

function schedulePersist(s) {
  if (!s) return;
  s.lastActivityAt = now();
  if (s.persistTimer) clearTimeout(s.persistTimer);
  s.persistTimer = setTimeout(() => {
    s.persistTimer = null;
    writeSessionToDisk(s).catch(() => {});
  }, 650);
  s.persistTimer.unref?.();
}

async function loadSessionFromDisk(repoRoot, sessionId) {
  const root = String(repoRoot || '');
  const sid = String(sessionId || '').trim();
  if (!root || !sid) return null;
  if (sessions.has(sid)) return sessions.get(sid);

  const s = {
    sessionId: sid,
    presentationId: '',
    repoRoot: root,
    slides: new Map(),
    createdAt: now(),
    lastActivityAt: now(),
    persistTimer: null,
  };

  const f = sessionFile(root, sid);
  try {
    const raw = await fs.readFile(f, 'utf8');
    const data = JSON.parse(raw);
    s.presentationId = safeString(data?.presentationId);
    s.createdAt = Number(data?.createdAt || 0) || s.createdAt;
    s.lastActivityAt = Number(data?.lastActivityAt || 0) || s.lastActivityAt;

    const slides = safeObject(data?.slides);
    for (const [slideId, st0] of Object.entries(slides)) {
      const st = safeObject(st0);
      const entries = new Map();
      const entriesObj = safeObject(st.entriesByDevice);
      for (const [deviceId, it0] of Object.entries(entriesObj)) {
        const di = safeString(deviceId);
        if (!di) continue;
        const it = safeObject(it0);
        const text = safeString(it.text);
        entries.set(di, {
          text,
          createdAt: Number(it.createdAt || 0) || now(),
          updatedAt: Number(it.updatedAt || 0) || now(),
        });
      }
      s.slides.set(String(slideId), {
        slideId: String(slideId),
        status: safeString(st.status) === 'closed' ? 'closed' : 'open',
        entriesByDevice: entries,
        createdAt: Number(st.createdAt || 0) || now(),
        updatedAt: Number(st.updatedAt || 0) || now(),
      });
    }
  } catch {
    // New session; ignore missing/bad files.
  }

  // Expiry is best-effort; if old data exists, it will be overwritten when session is active again.
  if (now() - s.lastActivityAt > TTL_MS) {
    // keep on disk; reset in memory to avoid unbounded growth
    s.slides = new Map();
    s.createdAt = now();
    s.lastActivityAt = now();
  }

  sessions.set(sid, s);
  return s;
}

function aggregateForDevice(st, deviceId) {
  const entries = st?.entriesByDevice instanceof Map ? st.entriesByDevice : new Map();
  const total = entries.size;
  const mine = deviceId && entries.has(deviceId) ? entries.get(deviceId) : null;
  return {
    slideId: st.slideId,
    type: 'feedback',
    status: st.status,
    open: st.status !== 'closed',
    total,
    myText: mine?.text ?? undefined,
    updatedAt: Number(st.updatedAt || 0) || now(),
  };
}

async function maybeBroadcast(repoRoot, sessionId, agg) {
  try {
    await notifyPresentSessionInteractionState(repoRoot, sessionId, agg);
  } catch {
    // ignore
  }
}

export async function ensureFeedbackForSlide(
  repoRoot,
  sessionId,
  { presentationId = '', slideId = '', defaultStatus = 'open' } = {}
) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return null;
  if (presentationId) s.presentationId = String(presentationId || '').trim();

  const sid = String(slideId || '').trim();
  if (!sid) return null;

  let st = s.slides.get(sid);
  if (!st) {
    st = {
      slideId: sid,
      status: String(defaultStatus) === 'closed' ? 'closed' : 'open',
      entriesByDevice: new Map(),
      createdAt: now(),
      updatedAt: now(),
    };
    s.slides.set(sid, st);
  }
  st.slideId = sid;
  st.updatedAt = now();
  schedulePersist(s);

  const agg = aggregateForDevice(st, null);
  await maybeBroadcast(repoRoot, sessionId, agg);
  return agg;
}

export async function getFeedbackAggregate(
  repoRoot,
  sessionId,
  { slideId = '', deviceId = null } = {}
) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return null;
  const sid = String(slideId || '').trim();
  if (!sid) return null;
  const st = s.slides.get(sid);
  if (!st) return null;
  st.updatedAt = now();
  schedulePersist(s);
  return aggregateForDevice(st, deviceId);
}

export async function submitFeedback(
  repoRoot,
  sessionId,
  { presentationId = '', slideId = '', deviceId = '', text = '' } = {}
) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return { ok: false, reason: 'no_session' };
  if (presentationId) s.presentationId = String(presentationId || '').trim();

  const sid = String(slideId || '').trim();
  const did = String(deviceId || '').trim();
  if (!sid || !did) return { ok: false, reason: 'bad_request' };

  let st = s.slides.get(sid);
  if (!st) {
    st = {
      slideId: sid,
      status: 'open',
      entriesByDevice: new Map(),
      createdAt: now(),
      updatedAt: now(),
    };
    s.slides.set(sid, st);
  }
  if (st.status === 'closed') return { ok: false, reason: 'closed' };

  const t = String(text || '').trim();
  if (!t) return { ok: false, reason: 'empty' };
  // Keep payloads sane for storage/export.
  const limited = t.length > 4000 ? t.slice(0, 4000) : t;

  const prev = st.entriesByDevice.has(did) ? st.entriesByDevice.get(did) : null;
  const createdAt = prev?.createdAt ? Number(prev.createdAt) : now();
  st.entriesByDevice.set(did, {
    text: limited,
    createdAt: Number(createdAt || 0) || now(),
    updatedAt: now(),
  });
  st.updatedAt = now();
  schedulePersist(s);

  const aggForDevice = aggregateForDevice(st, did);
  const aggForBroadcast = aggregateForDevice(st, null);
  await maybeBroadcast(repoRoot, sessionId, aggForBroadcast);

  // Fire webhook when feedback is submitted
  maybeFireInteractionWebhook(repoRoot, {
    event: 'interaction.feedback_submitted',
    sessionId,
    interaction: aggForBroadcast,
  }).catch(() => {});

  return { ok: true, aggregate: aggForDevice };
}

export async function setFeedbackStatus(
  repoRoot,
  sessionId,
  { slideId = '', status = 'open' } = {}
) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return null;
  const sid = String(slideId || '').trim();
  if (!sid) return null;
  const st = s.slides.get(sid);
  if (!st) return null;
  st.status = String(status) === 'closed' ? 'closed' : 'open';
  st.updatedAt = now();
  schedulePersist(s);
  const agg = aggregateForDevice(st, null);
  await maybeBroadcast(repoRoot, sessionId, agg);
  return agg;
}

export async function resetFeedback(repoRoot, sessionId, { slideId = '' } = {}) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return null;
  const sid = String(slideId || '').trim();
  if (!sid) return null;
  const st = s.slides.get(sid);
  if (!st) return null;
  st.entriesByDevice = new Map();
  st.updatedAt = now();
  schedulePersist(s);
  const agg = aggregateForDevice(st, null);
  await maybeBroadcast(repoRoot, sessionId, agg);
  return agg;
}

export async function listFeedbackEntries(repoRoot, sessionId, { slideId = '' } = {}) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return [];
  const sid = String(slideId || '').trim();
  if (!sid) return [];
  const st = s.slides.get(sid);
  if (!st) return [];
  const out = [];
  for (const [deviceId, it] of st.entriesByDevice.entries()) {
    out.push({
      slideId: sid,
      deviceId,
      text: safeString(it?.text),
      createdAt: Number(it?.createdAt || 0) || 0,
      updatedAt: Number(it?.updatedAt || 0) || 0,
    });
  }
  // stable-ish ordering: createdAt then updatedAt then deviceId
  out.sort((a, b) => (a.createdAt - b.createdAt) || (a.updatedAt - b.updatedAt) || String(a.deviceId).localeCompare(String(b.deviceId)));
  return out;
}
