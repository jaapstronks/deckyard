import fs from 'node:fs/promises';
import { sseWrite } from '../../utils/sse.js';
import { sessions } from './state.js';
import { sessionFile } from './disk.js';

export function closeSession(sessionId, reason = 'closed') {
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
