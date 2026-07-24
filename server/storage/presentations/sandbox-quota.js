/**
 * Per-guest disk quota for sandbox mode.
 *
 * Sandbox is a public, anonymous playground where many guests share one
 * instance and one data volume. Isolation is per-cookie, but nothing otherwise
 * bounds how many decks (or how many bytes) a single guest — or a determined
 * abuser rotating cookies/IPs — can pile into `sandbox_data`. This module caps
 * both per guest and refuses new decks with a typed 4xx once the cap is hit,
 * instead of letting the disk fill.
 *
 * The per-guest guarantee is really the pair (deck-count cap × request body
 * cap): `MAX_REQUEST_BODY_BYTES` bounds any single deck/import, and the count
 * cap bounds how many a guest can own, so total per-guest bytes are bounded even
 * though the byte scan below is only checked at mint time (a near-empty deck).
 * The explicit byte cap adds a second gate: once a guest's *stored* bytes are
 * already over budget, no further decks are minted.
 *
 * No-ops outside sandbox mode and for requests without an owner email, so it is
 * safe to call from the shared create/duplicate path.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { sandboxEnabled } from '../../config/sandbox.js';
import { presDir } from './paths.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { AppError } from '../../utils/errors.js';

/** Default max decks a single sandbox guest may own. */
const DEFAULT_MAX_DECKS_PER_GUEST = 25;
/** Default max total bytes across a single guest's stored decks (50 MB). */
const DEFAULT_MAX_BYTES_PER_GUEST = 50 * 1024 * 1024;

function positiveIntFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** @returns {number} Max decks per sandbox guest. */
export function sandboxMaxDecksPerGuest() {
  return positiveIntFromEnv('SANDBOX_MAX_DECKS_PER_GUEST', DEFAULT_MAX_DECKS_PER_GUEST);
}

/** @returns {number} Max total stored bytes per sandbox guest. */
export function sandboxMaxBytesPerGuest() {
  return positiveIntFromEnv('SANDBOX_MAX_BYTES_PER_GUEST', DEFAULT_MAX_BYTES_PER_GUEST);
}

/**
 * Global soft ceiling for the whole presentations dir, used by the cleanup loop
 * as a non-destructive observability guard. `0`/unset disables the check.
 * @returns {number}
 */
export function sandboxMaxTotalBytes() {
  return positiveIntFromEnv('SANDBOX_MAX_TOTAL_BYTES', 0);
}

/**
 * Error thrown when a sandbox guest hits their disk quota. Maps to HTTP 429 via
 * the AppError status, with a stable machine code clients can branch on.
 */
export class SandboxQuotaError extends AppError {
  /** @param {string} message @param {object} [details] */
  constructor(message, details = null) {
    super(message, 429, details, 'sandbox_quota_exceeded');
  }
}

/**
 * Count a guest's decks and sum their on-disk bytes by scanning the shared
 * presentations dir. One read per deck file (owner lives inside the JSON).
 * @param {string} repoRoot
 * @param {string} ownerEmail
 * @returns {Promise<{ deckCount: number, totalBytes: number }>}
 */
export async function getSandboxUsageForOwner(repoRoot, ownerEmail) {
  const owner = normalizeEmail(ownerEmail);
  if (!owner) return { deckCount: 0, totalBytes: 0 };

  const dir = presDir(repoRoot);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return { deckCount: 0, totalBytes: 0 };
  }

  let deckCount = 0;
  let totalBytes = 0;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let raw;
    try {
      raw = await fs.readFile(path.join(dir, f));
    } catch {
      continue;
    }
    let pres;
    try {
      pres = JSON.parse(raw.toString('utf8'));
    } catch {
      continue;
    }
    if (normalizeEmail(pres?.ownerEmail) !== owner) continue;
    deckCount += 1;
    totalBytes += raw.length;
  }
  return { deckCount, totalBytes };
}

/**
 * Sum on-disk bytes of every deck file in the shared presentations dir.
 * Cheap (stat only) — used by the cleanup loop's global disk-usage guard.
 * @param {string} repoRoot
 * @returns {Promise<number>}
 */
export async function getSandboxTotalBytes(repoRoot) {
  const dir = presDir(repoRoot);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let total = 0;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const st = await fs.stat(path.join(dir, f));
      total += st.size;
    } catch {
      // ignore
    }
  }
  return total;
}

/**
 * Throw {@link SandboxQuotaError} when minting one more deck for `ownerEmail`
 * would exceed the per-guest deck-count cap, or the guest's stored bytes are
 * already over the per-guest byte cap. No-op outside sandbox mode or without an
 * owner email, so it is safe to call unconditionally from the create path.
 * @param {string} repoRoot
 * @param {string} ownerEmail
 * @returns {Promise<void>}
 */
export async function assertSandboxQuotaForCreate(repoRoot, ownerEmail) {
  if (!sandboxEnabled()) return;
  const owner = normalizeEmail(ownerEmail);
  if (!owner) return;

  const maxDecks = sandboxMaxDecksPerGuest();
  const maxBytes = sandboxMaxBytesPerGuest();
  const { deckCount, totalBytes } = await getSandboxUsageForOwner(repoRoot, owner);

  if (deckCount >= maxDecks) {
    throw new SandboxQuotaError(
      `Sandbox deck limit reached (${maxDecks} per guest). Delete a deck to make room.`,
      { limit: maxDecks, deckCount }
    );
  }
  if (totalBytes >= maxBytes) {
    throw new SandboxQuotaError(
      'Sandbox storage limit reached. Delete a deck to make room.',
      { limitBytes: maxBytes, totalBytes }
    );
  }
}
