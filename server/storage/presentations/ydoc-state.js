/**
 * File-backend storage for collab Y.Doc state (one merged yjs update per
 * deck, stored as `presentation-ydocs/<id>.bin` under the data dir).
 *
 * The binary is a cache of the live CRDT state; the deck JSON remains the
 * durable format (ADR 001 §5). Deleting a .bin file is always safe — the
 * doc re-bootstraps from JSON on the next collab open.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from '../../config/storage-paths.js';

function ydocDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'presentation-ydocs');
}

/** Presentation ids are uuids; refuse anything that could traverse paths. */
function safeId(id) {
  const s = String(id || '');
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

function ydocPath(repoRoot, id) {
  return path.join(ydocDir(repoRoot), `${id}.bin`);
}

/**
 * Read the stored Y.Doc state for a presentation.
 * @param {string} repoRoot
 * @param {string} id - Presentation ID
 * @returns {Promise<Uint8Array|null>} The merged yjs update, or null
 */
export async function getYDocState(repoRoot, id) {
  const sid = safeId(id);
  if (!sid) return null;
  try {
    const buf = await fs.readFile(ydocPath(repoRoot, sid));
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Store the Y.Doc state for a presentation (atomic write).
 * @param {string} repoRoot
 * @param {string} id - Presentation ID
 * @param {Uint8Array} state - Merged yjs update
 * @returns {Promise<boolean>}
 */
export async function setYDocState(repoRoot, id, state) {
  const sid = safeId(id);
  if (!sid || !(state instanceof Uint8Array)) return false;
  const dir = ydocDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${sid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmp, state);
  await fs.rename(tmp, ydocPath(repoRoot, sid));
  return true;
}

/**
 * Delete the stored Y.Doc state for a presentation.
 * @param {string} repoRoot
 * @param {string} id - Presentation ID
 * @returns {Promise<boolean>} true when a file was removed
 */
export async function deleteYDocState(repoRoot, id) {
  const sid = safeId(id);
  if (!sid) return false;
  try {
    await fs.unlink(ydocPath(repoRoot, sid));
    return true;
  } catch {
    return false;
  }
}
