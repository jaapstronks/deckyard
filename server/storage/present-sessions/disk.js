import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TTL_MS } from './constants.js';
import { loadedRoots, sessions } from './state.js';
import { dataDir } from '../../config/storage-paths.js';

export function sessionsDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'present-sessions');
}

export function sessionFile(repoRoot, sessionId) {
  return path.join(sessionsDir(repoRoot), `${sessionId}.json`);
}

export function isExpired(s) {
  const last = Number(s?.lastActivityAt || 0) || 0;
  if (!last) return true;
  return Date.now() - last > TTL_MS;
}

export function serializeSession(s) {
  return {
    sessionId: s.sessionId,
    presentationId: s.presentationId,
    state: s.state,
    controlEnabled: !!s.controlEnabled,
    followCodes: s.followCodes || {},
    createdAt: Number(s.createdAt || 0) || Date.now(),
    lastActivityAt: Number(s.lastActivityAt || 0) || Date.now(),
  };
}

export async function writeSessionToDisk(s) {
  const repoRoot = s?.repoRoot;
  if (!repoRoot || !s?.sessionId) return;
  const dir = sessionsDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${s.sessionId}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(serializeSession(s), null, 2), 'utf8');
  await fs.rename(tmp, sessionFile(repoRoot, s.sessionId));
}

export function schedulePersist(s) {
  if (!s) return;
  if (s.persistTimer) clearTimeout(s.persistTimer);
  s.persistTimer = setTimeout(() => {
    s.persistTimer = null;
    writeSessionToDisk(s).catch(() => {});
  }, 600);
  s.persistTimer.unref?.();
}

export async function loadSessionsFromDisk(repoRoot) {
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
        state: data.state || {
          slideId: '',
          slideIndex: 0,
          updatedAt: Date.now(),
        },
        controlEnabled: !!data.controlEnabled,
        followCodes: data.followCodes || {},
        createdAt: Number(data.createdAt || 0) || Date.now(),
        lastActivityAt: Number(data.lastActivityAt || 0) || Date.now(),
        repoRoot: root,
        clients: new Set(),
        heartbeatTimers: new Map(),
        persistTimer: null,
      };
      // Back-compat: older sessions had no step state.
      s.state = s.state && typeof s.state === 'object' ? s.state : {};
      if (typeof s.state.slideId !== 'string') s.state.slideId = '';
      s.state.slideIndex = Number(s.state.slideIndex || 0) || 0;
      s.state.updatedAt = Number(s.state.updatedAt || 0) || Date.now();
      s.state.stepIdx = Math.max(0, Number(s.state.stepIdx || 0) || 0);
      if (typeof s.state.stepParagraphs !== 'boolean') s.state.stepParagraphs = false;
      if (typeof s.state.slideType !== 'string') s.state.slideType = '';
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
