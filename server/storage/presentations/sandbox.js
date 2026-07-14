import fs from 'node:fs/promises';
import path from 'node:path';
import { sandboxEnabled, sandboxTtlMs } from '../../config/sandbox.js';
import { dataDir } from '../../config/storage-paths.js';
import { removePublishedEntry } from '../published.js';
import { deletePresentationFile } from './io.js';

function safeIsoToMs(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function versionsDir(repoRoot, presentationId) {
  return path.join(
    dataDir(repoRoot),
    'presentation-versions',
    String(presentationId || '')
  );
}

export function isSandboxEphemeralPresentation(pres) {
  if (!sandboxEnabled()) return false;
  if (!pres || typeof pres !== 'object') return false;
  // Treat workspace-scope decks as curated seed decks that should not expire.
  return String(pres.scope || 'private') !== 'workspace';
}

export function isSandboxExpiredPresentation(pres, { nowMs = Date.now() } = {}) {
  if (!isSandboxEphemeralPresentation(pres)) return false;
  const createdMs = safeIsoToMs(pres?.created);
  if (!createdMs) return false;
  return nowMs - createdMs >= sandboxTtlMs();
}

export function attachSandboxMeta(pres) {
  if (!isSandboxEphemeralPresentation(pres)) return pres;
  const createdMs = safeIsoToMs(pres?.created) || Date.now();
  const expires = new Date(createdMs + sandboxTtlMs()).toISOString();
  pres.sandbox =
    pres?.sandbox && typeof pres.sandbox === 'object'
      ? pres.sandbox
      : {};
  pres.sandbox.enabled = true;
  pres.sandbox.expires = expires;
  return pres;
}

export async function cleanupExpiredSandboxPresentation(repoRoot, pres) {
  if (!isSandboxExpiredPresentation(pres)) return false;
  const id = String(pres?.id || '').trim();
  if (!id) return false;

  // Best-effort: remove published entry (if any).
  try {
    const publishId = String(pres?.published?.id || '').trim();
    if (publishId) await removePublishedEntry(repoRoot, publishId);
  } catch {
    // ignore
  }

  // Best-effort: remove version snapshots.
  try {
    await fs.rm(versionsDir(repoRoot, id), {
      recursive: true,
      force: true,
    });
  } catch {
    // ignore
  }

  // Delete the presentation itself.
  try {
    await deletePresentationFile(repoRoot, id);
  } catch {
    // ignore
  }
  return true;
}
