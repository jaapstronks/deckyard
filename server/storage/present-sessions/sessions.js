import { createFollowCode } from '../follow-codes.js';
import { TTL_MS } from './constants.js';
import { sessions } from './state.js';
import { isExpired, loadSessionsFromDisk, schedulePersist } from './disk.js';
import { newSessionId, nowState } from './ids.js';
import { closeSession } from './close.js';

// Follow codes expire after 24 hours (must match follow-codes.js)
const FOLLOW_CODE_TTL_MS = 24 * 60 * 60 * 1000;

function areFollowCodesExpired(session) {
  const createdAt = session.followCodesCreatedAt || session.createdAt || 0;
  return Date.now() - createdAt > FOLLOW_CODE_TTL_MS;
}

async function refreshFollowCodes(repoRoot, session) {
  const presId = session.presentationId;
  const followCodes = {};

  try {
    const nlFollowUrl = `/follow/${encodeURIComponent(presId)}?lang=nl`;
    const enFollowUrl = `/follow/${encodeURIComponent(presId)}?lang=en-GB`;

    followCodes.nl = await createFollowCode(repoRoot, nlFollowUrl);
    followCodes.en = await createFollowCode(repoRoot, enFollowUrl);

    session.followCodes = followCodes;
    session.followCodesCreatedAt = Date.now();

    // Don't log the code values: a live follow code resolves to a presenter's
    // follow URL, so it's a secret (audit L2).
    console.log(`[Follow Codes] Refreshed expired codes for presentation ${presId}`);
  } catch (error) {
    console.error('Failed to refresh follow codes:', error);
  }

  return followCodes;
}

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
        closeSession(id, 'expired');
      } catch {
        sessions.delete(id);
      }
    }
  }, 60 * 1000).unref?.();
}

export async function createPresentSession(repoRoot, { presentationId }) {
  ensureCleanupTimer();
  await loadSessionsFromDisk(repoRoot);
  const presId = String(presentationId || '').trim();
  if (!presId) return null;

  // Reuse existing session for this deck if still active.
  for (const s of sessions.values()) {
    if (s?.presentationId !== presId) continue;
    if (isExpired(s)) {
      try {
        closeSession(s.sessionId, 'expired');
      } catch {}
      continue;
    }

    // Check if follow codes need refresh
    let followCodes = s.followCodes || {};
    if (areFollowCodesExpired(s)) {
      console.log(`[Follow Codes] Codes expired for session ${s.sessionId}, refreshing...`);
      followCodes = await refreshFollowCodes(repoRoot, s);
    }

    s.lastActivityAt = Date.now();
    schedulePersist(s);
    return {
      sessionId: s.sessionId,
      joinPath: `/notes/${s.sessionId}`,
      followCodes,
    };
  }

  const sessionId = newSessionId();

  // Generate follow codes for both languages
  const followCodes = {};
  const now = Date.now();
  try {
    const nlFollowUrl = `/follow/${encodeURIComponent(presId)}?lang=nl`;
    const enFollowUrl = `/follow/${encodeURIComponent(presId)}?lang=en-GB`;

    followCodes.nl = await createFollowCode(repoRoot, nlFollowUrl);
    followCodes.en = await createFollowCode(repoRoot, enFollowUrl);

    // Don't log the code values (secret; see audit L2).
    console.log(`[Follow Codes] Generated for presentation ${presId}`);
  } catch (error) {
    // If code generation fails, continue without codes
    console.error('Failed to generate follow codes:', error);
  }

  const s = {
    sessionId,
    presentationId: presId,
    state: {
      slideId: '',
      slideIndex: 0,
      ...nowState(),
    },
    controlEnabled: false,
    followCodes,
    followCodesCreatedAt: now,
    createdAt: now,
    lastActivityAt: now,
    repoRoot,
    clients: new Set(),
    heartbeatTimers: new Map(),
    persistTimer: null,
  };
  sessions.set(sessionId, s);
  schedulePersist(s);
  return {
    sessionId,
    joinPath: `/notes/${sessionId}`,
    followCodes,
  };
}

export async function getPresentSession(repoRoot, sessionId) {
  await loadSessionsFromDisk(repoRoot);
  return sessions.get(String(sessionId || '')) || null;
}

export async function findMostRecentSessionForPresentation(repoRoot, presentationId) {
  await loadSessionsFromDisk(repoRoot);
  const pid = String(presentationId || '').trim();
  if (!pid) return null;
  let best = null;
  let bestTs = -1;
  for (const s of sessions.values()) {
    if (!s || s.presentationId !== pid) continue;
    const ts = Number(s?.state?.updatedAt || 0) || Number(s?.createdAt || 0) || 0;
    if (ts > bestTs) {
      bestTs = ts;
      best = s;
    }
  }
  return best;
}

export async function touchPresentSession(repoRoot, sessionId) {
  const s = await getPresentSession(repoRoot, sessionId);
  if (!s) return null;
  s.lastActivityAt = Date.now();
  schedulePersist(s);
  return s;
}
