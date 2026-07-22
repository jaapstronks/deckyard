import fs from 'node:fs/promises';
import path from 'node:path';
import { notifyPresentSessionInteractionState } from './present-sessions.js';
import { writeJsonAtomic } from './io.js';
import { dataDir } from '../config/storage-paths.js';
import { maybeFireInteractionWebhook } from '../utils/webhooks.js';

/**
 * Follow-native interactions storage (session-scoped).
 *
 * Authoritative key: { sessionId, slideId } (NOT pollId).
 * Stores per-device votes so we can enforce "one vote per device" and allow changes.
 */

const TTL_MS = 24 * 60 * 60 * 1000; // ~1 day (matches present-sessions)

/** @type {Map<string, any>} */
const sessions = new Map();

function interactionsDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'interactions');
}

function sessionFile(repoRoot, sessionId) {
  return path.join(interactionsDir(repoRoot), `${sessionId}.json`);
}

function now() {
  return Date.now();
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
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
    const votesByDevice = {};
    for (const [deviceId, idx] of st.votesByDevice.entries()) {
      votesByDevice[deviceId] = idx;
    }
    // Compute totals from votesByDevice for storage (single source of truth)
    const totals = computeTotalsFromVotes(st.votesByDevice, st.optionCount);
    slides[slideId] = {
      type: st.type,
      status: st.status,
      optionCount: st.optionCount,
      totals,
      votesByDevice,
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
  }, 600);
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
      const votes = new Map();
      const votesObj = safeObject(st.votesByDevice);
      for (const [deviceId, idx] of Object.entries(votesObj)) {
        const di = safeString(deviceId);
        if (!di) continue;
        votes.set(di, clampInt(idx, 0, 100));
      }
      const optionCount = clampInt(st.optionCount, 0, 10);
      // Note: totals is not stored in memory - it's computed on-the-fly from votesByDevice
      s.slides.set(String(slideId), {
        type: safeString(st.type) || 'poll',
        status: safeString(st.status) === 'closed' ? 'closed' : 'open',
        optionCount,
        votesByDevice: votes,
        updatedAt: Number(st.updatedAt || 0) || now(),
        createdAt: Number(st.createdAt || 0) || now(),
      });
    }
  } catch {
    // New session; ignore missing/bad files.
  }

  // Expired sessions are left on disk for now; present-sessions TTL already governs liveness.
  sessions.set(sid, s);
  return s;
}

/**
 * Compute totals array from votesByDevice (single source of truth).
 * This ensures totals always accurately reflect the actual votes.
 */
function computeTotalsFromVotes(votesByDevice, optionCount) {
  const n = clampInt(optionCount, 0, 10);
  const totals = Array.from({ length: n }, () => 0);
  for (const idx of votesByDevice.values()) {
    const i = clampInt(idx, 0, n - 1);
    if (i >= 0 && i < n) {
      totals[i] += 1;
    }
  }
  return totals;
}

function ensureOptionCount(st, optionCount) {
  const n = clampInt(optionCount, 0, 10);
  st.optionCount = n;
  // If option count shrank, drop any votes pointing outside the range.
  for (const [deviceId, idx] of Array.from(st.votesByDevice.entries())) {
    if (idx < 0 || idx >= n) st.votesByDevice.delete(deviceId);
  }
}

function aggregateForDevice(st, deviceId) {
  // Always compute totals from votesByDevice - single source of truth
  const totals = computeTotalsFromVotes(st.votesByDevice, st.optionCount);
  const total = totals.reduce((a, b) => a + b, 0);
  const myVote =
    deviceId && st.votesByDevice.has(deviceId)
      ? clampInt(st.votesByDevice.get(deviceId), 0, 100)
      : null;
  return {
    slideId: st.slideId,
    type: st.type,
    status: st.status,
    open: st.status !== 'closed',
    optionCount: st.optionCount,
    totals,
    total,
    myVote: myVote ?? undefined,
    updatedAt: Number(st.updatedAt || 0) || now(),
  };
}

async function maybeBroadcast(repoRoot, sessionId, agg) {
  // Fire and forget; this goes to presenter + follow (via attachSessionSseClient).
  try {
    await notifyPresentSessionInteractionState(repoRoot, sessionId, agg);
  } catch {
    // ignore
  }
}

const BROADCAST_COALESCE_MS = 250;

/** @type {Map<string, { timer: any, lastSentAt: number }>} */
const broadcastStates = new Map();

function sweepBroadcastStates() {
  if (broadcastStates.size <= 500) return;
  const cutoff = now() - TTL_MS;
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
 */
function scheduleInteractionBroadcast(repoRoot, sessionId, st, { immediate = false } = {}) {
  const key = `${sessionId}\n${st.slideId}`;
  let b = broadcastStates.get(key);
  if (!b) {
    b = { timer: null, lastSentAt: 0 };
    broadcastStates.set(key, b);
    sweepBroadcastStates();
  }
  const send = () => {
    b.lastSentAt = now();
    // Aggregate is computed at send time so a coalesced broadcast always
    // carries the latest totals.
    maybeBroadcast(repoRoot, sessionId, aggregateForDevice(st, null)).catch(() => {});
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

function normalizeInteractionType(type) {
  const t = String(type || '').trim();
  if (t === 'poll' || t === 'likert') return t;
  return 'poll';
}

async function ensureInteractionForSlide(
  repoRoot,
  sessionId,
  {
    type = 'poll',
    presentationId = '',
    slideId = '',
    optionCount = 0,
    defaultStatus = 'open',
  } = {}
) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return null;
  if (presentationId) s.presentationId = String(presentationId || '').trim();

  const sid = String(slideId || '').trim();
  if (!sid) return null;
  const it = normalizeInteractionType(type);

  let st = s.slides.get(sid);
  if (!st) {
    st = {
      slideId: sid,
      type: it,
      status: defaultStatus === 'closed' ? 'closed' : 'open',
      optionCount: 0,
      votesByDevice: new Map(),
      createdAt: now(),
      updatedAt: now(),
    };
    s.slides.set(sid, st);
  }
  st.slideId = sid;
  st.type = it;
  ensureOptionCount(st, optionCount);
  st.updatedAt = now();
  schedulePersist(s);

  const agg = aggregateForDevice(st, null);
  scheduleInteractionBroadcast(repoRoot, sessionId, st);
  return agg;
}

async function getInteractionAggregate(
  repoRoot,
  sessionId,
  { slideId = '', deviceId = null, optionCount = null } = {}
) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return null;
  const sid = String(slideId || '').trim();
  if (!sid) return null;
  const st = s.slides.get(sid);
  if (!st) return null;
  if (optionCount != null) ensureOptionCount(st, optionCount);
  st.updatedAt = now();
  schedulePersist(s);
  return aggregateForDevice(st, deviceId);
}

async function voteInteraction(
  repoRoot,
  sessionId,
  {
    type = 'poll',
    presentationId = '',
    slideId = '',
    deviceId = '',
    optionIndex = 0,
    optionCount = 0,
  } = {}
) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return { ok: false, reason: 'no_session' };
  if (presentationId) s.presentationId = String(presentationId || '').trim();

  const sid = String(slideId || '').trim();
  const did = String(deviceId || '').trim();
  if (!sid || !did) return { ok: false, reason: 'bad_request' };

  const it = normalizeInteractionType(type);

  let st = s.slides.get(sid);
  if (!st) {
    // Auto-create (open) so the first voter doesn't need a presenter action.
    st = {
      slideId: sid,
      type: it,
      status: 'open',
      optionCount: 0,
      votesByDevice: new Map(),
      createdAt: now(),
      updatedAt: now(),
    };
    s.slides.set(sid, st);
  }

  st.type = it;
  ensureOptionCount(st, optionCount);
  const idx = clampInt(optionIndex, 0, Math.max(0, st.optionCount - 1));
  if (st.status === 'closed') return { ok: false, reason: 'closed' };

  // votesByDevice is the single source of truth - just update it.
  // Totals will be computed on-the-fly in aggregateForDevice.
  st.votesByDevice.set(did, idx);
  st.updatedAt = now();
  schedulePersist(s);

  const agg = aggregateForDevice(st, did);
  scheduleInteractionBroadcast(repoRoot, sessionId, st);
  return { ok: true, aggregate: agg };
}

async function setInteractionStatus(
  repoRoot,
  sessionId,
  { slideId = '', status = 'open', optionCount = null } = {}
) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return null;
  const sid = String(slideId || '').trim();
  if (!sid) return null;
  const st = s.slides.get(sid);
  if (!st) return null;
  if (optionCount != null) ensureOptionCount(st, optionCount);
  const prevStatus = st.status;
  st.status = String(status) === 'closed' ? 'closed' : 'open';
  st.updatedAt = now();
  schedulePersist(s);
  const agg = aggregateForDevice(st, null);
  scheduleInteractionBroadcast(repoRoot, sessionId, st, { immediate: true });

  // Fire webhook when interaction is closed
  if (prevStatus !== 'closed' && st.status === 'closed') {
    const webhookEvent =
      st.type === 'likert'
        ? 'interaction.likert_closed'
        : 'interaction.poll_closed';
    maybeFireInteractionWebhook(repoRoot, {
      event: webhookEvent,
      sessionId,
      interaction: agg,
    }).catch(() => {});
  }

  return agg;
}

async function resetInteraction(repoRoot, sessionId, { slideId = '', optionCount = null } = {}) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return null;
  const sid = String(slideId || '').trim();
  if (!sid) return null;
  const st = s.slides.get(sid);
  if (!st) return null;
  if (optionCount != null) ensureOptionCount(st, optionCount);
  // Clear all votes - totals will automatically be zeros when computed
  st.votesByDevice = new Map();
  st.updatedAt = now();
  schedulePersist(s);
  const agg = aggregateForDevice(st, null);
  scheduleInteractionBroadcast(repoRoot, sessionId, st, { immediate: true });
  return agg;
}

// ---- Poll wrappers (back-compat) ----

export async function ensurePollInteractionForSlide(repoRoot, sessionId, opts = {}) {
  return ensureInteractionForSlide(repoRoot, sessionId, { ...opts, type: 'poll' });
}

export async function getPollInteractionAggregate(repoRoot, sessionId, opts = {}) {
  return getInteractionAggregate(repoRoot, sessionId, opts);
}

export async function votePollInteraction(repoRoot, sessionId, opts = {}) {
  return voteInteraction(repoRoot, sessionId, { ...opts, type: 'poll' });
}

export async function setPollInteractionStatus(repoRoot, sessionId, opts = {}) {
  return setInteractionStatus(repoRoot, sessionId, opts);
}

export async function resetPollInteraction(repoRoot, sessionId, opts = {}) {
  return resetInteraction(repoRoot, sessionId, opts);
}

// ---- Likert (new) ----

export async function ensureLikertInteractionForSlide(repoRoot, sessionId, opts = {}) {
  return ensureInteractionForSlide(repoRoot, sessionId, { ...opts, type: 'likert' });
}

export async function getLikertInteractionAggregate(repoRoot, sessionId, opts = {}) {
  return getInteractionAggregate(repoRoot, sessionId, opts);
}

export async function voteLikertInteraction(repoRoot, sessionId, opts = {}) {
  return voteInteraction(repoRoot, sessionId, { ...opts, type: 'likert' });
}

export async function setLikertInteractionStatus(repoRoot, sessionId, opts = {}) {
  return setInteractionStatus(repoRoot, sessionId, opts);
}

export async function resetLikertInteraction(repoRoot, sessionId, opts = {}) {
  return resetInteraction(repoRoot, sessionId, opts);
}

export async function hasAnyInteractionResults(repoRoot, sessionId) {
  const s = await loadSessionFromDisk(repoRoot, sessionId);
  if (!s) return false;
  for (const st of s.slides.values()) {
    // votesByDevice is the source of truth - check if any votes exist
    if (st?.votesByDevice?.size > 0) return true;
  }
  return false;
}
