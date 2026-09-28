import path from 'node:path';
import { sandboxEnabled } from './sandbox.js';
import { envStr } from './utils.js';

function resolveMaybeRelative(repoRoot, raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Allow absolute paths (VPS/container), but also allow relative paths for local dev.
  if (path.isAbsolute(s)) return s;
  return path.join(repoRoot, s);
}

export function dataDir(repoRoot) {
  // Explicit override (all modes)
  const global = resolveMaybeRelative(repoRoot, envStr('DATA_DIR'));
  if (global) return global;

  // Sandbox override
  if (sandboxEnabled()) {
    const sb = resolveMaybeRelative(repoRoot, envStr('SANDBOX_DATA_DIR'));
    if (sb) return sb;
    return path.join(repoRoot, 'server', 'data-sandbox');
  }

  // Default
  return path.join(repoRoot, 'server', 'data');
}

export function uploadsDir(repoRoot) {
  // Explicit override (all modes)
  const global = resolveMaybeRelative(repoRoot, envStr('UPLOADS_DIR'));
  if (global) return global;

  // Sandbox override
  if (sandboxEnabled()) {
    const sb = resolveMaybeRelative(repoRoot, envStr('SANDBOX_UPLOADS_DIR'));
    if (sb) return sb;
    return path.join(repoRoot, 'server', 'uploads-sandbox');
  }

  // Default
  return path.join(repoRoot, 'server', 'uploads');
}

/**
 * Where the local media provider keeps *private* objects: files the app reads
 * and serves itself, never through a public static root. It lives under the
 * data dir, which no `SHARED_PUBLIC_DIRS` entry serves, so there is no URL that
 * reaches it except the app route that owns the object (for font variants:
 * `/fonts/managed/`, `server/routes/static/managed-fonts.js`).
 * @param {string} repoRoot
 * @returns {string}
 */
export function privateMediaDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'private-media');
}
