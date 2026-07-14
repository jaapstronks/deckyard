import path from 'node:path';
import { sandboxEnabled } from './sandbox.js';

function resolveMaybeRelative(repoRoot, raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Allow absolute paths (VPS/container), but also allow relative paths for local dev.
  if (path.isAbsolute(s)) return s;
  return path.join(repoRoot, s);
}

export function dataDir(repoRoot) {
  // Explicit override (all modes)
  const global = resolveMaybeRelative(repoRoot, process.env.DATA_DIR);
  if (global) return global;

  // Sandbox override
  if (sandboxEnabled()) {
    const sb = resolveMaybeRelative(repoRoot, process.env.SANDBOX_DATA_DIR);
    if (sb) return sb;
    return path.join(repoRoot, 'server', 'data-sandbox');
  }

  // Default
  return path.join(repoRoot, 'server', 'data');
}

export function uploadsDir(repoRoot) {
  // Explicit override (all modes)
  const global = resolveMaybeRelative(repoRoot, process.env.UPLOADS_DIR);
  if (global) return global;

  // Sandbox override
  if (sandboxEnabled()) {
    const sb = resolveMaybeRelative(repoRoot, process.env.SANDBOX_UPLOADS_DIR);
    if (sb) return sb;
    return path.join(repoRoot, 'server', 'uploads-sandbox');
  }

  // Default
  return path.join(repoRoot, 'server', 'uploads');
}
