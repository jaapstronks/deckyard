import fs from 'node:fs';
import path from 'node:path';

// Minimal, dependency-free .env loader (server-side only).
// - Only sets vars that are not already present in process.env
// - Supports simple KEY=VALUE pairs, with optional quotes
// - Everything after the first `=` is the value: there is no inline-comment
//   syntax, so a `#` inside a value stays part of the value. Comments get
//   their own line (the guard in tests/env-manifest.test.js pins that for
//   .env.example).
export function loadDotEnv(repoRoot) {
  const envPath = path.join(repoRoot, '.env');
  let raw = '';
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    if (process.env[key] != null) continue;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
