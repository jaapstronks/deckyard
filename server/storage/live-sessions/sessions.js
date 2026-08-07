import { createFollowCode, FOLLOW_CODE_TTL_MS } from '../follow-codes.js';
import { TTL_MS } from './constants.js';
import { sessions } from './state.js';
import {
  isExpired,
  hydrateSession,
  hydrateSessionsForPresentation,
  persistSession,
  schedulePersist,
} from './db.js';
import { newSessionId, nowState } from './ids.js';
import { closeSession } from './close.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('sessions');

function areFollowCodesExpired(session) {
  const createdAt = session.followCodesCreatedAt || session.createdAt || 0;
  return Date.now() - createdAt > FOLLOW_CODE_TTL_MS;
}

/**
 * Mint a follow code per language for a deck.
 *
 * A failure here is not fatal: the session is still usable, the audience just
 * has to follow the link instead of typing a code. A code is only omitted when
 * minting returned nothing (the database is unavailable), never faked.
 *
 * @param {string} repoRoot
 * @param {string} presentationId
 * @returns {Promise<Object<string, string>>} Codes by language key.
 */
async function mintFollowCodes(repoRoot, presentationId) {
  const followCodes = {};
  try {
    const byLang = {
      nl: `/follow/${encodeURIComponent(presentationId)}?lang=nl`,
      en: `/follow/${encodeURIComponent(presentationId)}?lang=en-GB`,
    };
    for (const [lang, followUrl] of Object.entries(byLang)) {
      const code = await createFollowCode(repoRoot, followUrl);
      if (code) followCodes[lang] = code;
    }
    // Don't log the code values: a live follow code resolves to a presenter's
    // follow URL, so it's a secret (audit L2).
    log.info(`[Follow Codes] Minted for presentation ${presentationId}`);
  } catch (error) {
    log.error('Failed to mint follow codes:', error);
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

export async function createLiveSession(repoRoot, { presentationId }) {
  ensureCleanupTimer();
  const presId = String(presentationId || '').trim();
  if (!presId) return null;

  // Adopt whatever is stored for this deck first, so a session another process
  // (or this one before a restart) started is reused rather than duplicated.
  await hydrateSessionsForPresentation(presId);

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
      log.info(`[Follow Codes] Codes expired for session ${s.sessionId}, refreshing...`);
      followCodes = await mintFollowCodes(repoRoot, presId);
      s.followCodes = followCodes;
      s.followCodesCreatedAt = Date.now();
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
  const followCodes = await mintFollowCodes(repoRoot, presId);
  const now = Date.now();

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
    clients: new Set(),
    heartbeatTimers: new Map(),
    persistTimer: null,
  };
  sessions.set(sessionId, s);
  // Awaited, not debounced: the row is what makes the session findable from
  // another process, and the presenter's very next request may land there.
  await persistSession(s);
  return {
    sessionId,
    joinPath: `/notes/${sessionId}`,
    followCodes,
  };
}

export async function getLiveSession(repoRoot, sessionId) {
  return hydrateSession(sessionId);
}

export async function findMostRecentSessionForPresentation(repoRoot, presentationId) {
  const pid = String(presentationId || '').trim();
  if (!pid) return null;
  await hydrateSessionsForPresentation(pid);
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

export async function touchLiveSession(repoRoot, sessionId) {
  const s = await getLiveSession(repoRoot, sessionId);
  if (!s) return null;
  s.lastActivityAt = Date.now();
  schedulePersist(s);
  return s;
}
