import fs from 'node:fs/promises';
import path from 'node:path';
import { sandboxEnabled } from '../config/sandbox.js';
import { readJsonIfExists } from '../storage/presentations/io.js';
import {
  cleanupExpiredSandboxPresentation,
  isSandboxExpiredPresentation,
} from '../storage/presentations/sandbox.js';
import { presDir } from '../storage/presentations/paths.js';

export function startSandboxCleanupLoop(repoRoot, { intervalMs = 10 * 60 * 1000 } = {}) {
  if (!sandboxEnabled()) return () => {};

  let stopped = false;
  let running = false;

  async function sweep() {
    if (stopped || running) return;
    running = true;
    try {
      const dir = presDir(repoRoot);
      await fs.mkdir(dir, { recursive: true });
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const full = path.join(dir, f);
        const pres = await readJsonIfExists(full);
        if (!pres) continue;
        if (!isSandboxExpiredPresentation(pres)) continue;
        await cleanupExpiredSandboxPresentation(repoRoot, pres);
      }
    } catch {
      // ignore (best-effort)
    } finally {
      running = false;
    }
  }

  // Run immediately, then on interval.
  sweep();
  const t = setInterval(sweep, Math.max(30_000, Number(intervalMs) || 10 * 60 * 1000));
  return () => {
    stopped = true;
    try {
      clearInterval(t);
    } catch {
      // ignore
    }
  };
}
