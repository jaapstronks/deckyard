/**
 * Per-guest storage quota for sandbox mode.
 *
 * Sandbox is a public, anonymous playground where many guests share one
 * instance and one database. Isolation is per-cookie, but nothing otherwise
 * bounds how many decks (or how many bytes) a single guest — or a determined
 * abuser rotating cookies/IPs — can pile into the `presentations` table. This
 * module caps both per guest and refuses new decks with a typed 4xx once the
 * cap is hit, instead of letting the volume fill.
 *
 * The per-guest guarantee is really the pair (deck-count cap × request body
 * cap): `MAX_REQUEST_BODY_BYTES` bounds any single deck/import, and the count
 * cap bounds how many a guest can own, so total per-guest bytes are bounded even
 * though the byte scan below is only checked at mint time (a near-empty deck).
 * The explicit byte cap adds a second gate: once a guest's *stored* bytes are
 * already over budget, no further decks are minted.
 *
 * Since sandbox runs on Postgres (the file backend is gone from every sandbox
 * deploy), the counts come from the `presentations` table, keyed on
 * `owner_email` within the instance's single organization — not a directory
 * scan. `pg_column_size(slides) + pg_column_size(i18n)` is the on-disk byte
 * proxy for a deck; it is the compressed jsonb size, so an approximation of the
 * old whole-file byte sum, which is all a coarse abuse guard needs.
 *
 * No-ops outside sandbox mode and for requests without an owner email, so it is
 * safe to call from the shared create/duplicate facade.
 */

import { getDb, sql } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { sandboxEnabled } from '../../config/sandbox.js';
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
function sandboxMaxDecksPerGuest() {
  return positiveIntFromEnv('SANDBOX_MAX_DECKS_PER_GUEST', DEFAULT_MAX_DECKS_PER_GUEST);
}

/** @returns {number} Max total stored bytes per sandbox guest. */
function sandboxMaxBytesPerGuest() {
  return positiveIntFromEnv('SANDBOX_MAX_BYTES_PER_GUEST', DEFAULT_MAX_BYTES_PER_GUEST);
}

/**
 * Global soft ceiling for the whole presentations table, used by the cleanup
 * loop as a non-destructive observability guard. `0`/unset disables the check.
 * @returns {number}
 */
export function sandboxMaxTotalBytes() {
  return positiveIntFromEnv('SANDBOX_MAX_TOTAL_BYTES', 0);
}

/**
 * Error thrown when a sandbox guest hits their storage quota. Maps to HTTP 429
 * via the AppError status, with a stable machine code clients can branch on.
 */
export class SandboxQuotaError extends AppError {
  /** @param {string} message @param {object} [details] */
  constructor(message, details = null) {
    super(message, 429, details, 'sandbox_quota_exceeded');
  }
}

/**
 * Count a guest's decks and sum their stored bytes in the shared presentations
 * table, scoped to the context's organization. The byte figure is the
 * compressed jsonb size of the two big columns (slides + i18n).
 * @param {object} ctx - Storage context carrying the organization.
 * @param {string} ownerEmail
 * @returns {Promise<{ deckCount: number, totalBytes: number }>}
 */
export async function getSandboxUsageForOwner(ctx, ownerEmail) {
  const owner = normalizeEmail(ownerEmail);
  if (!owner) return { deckCount: 0, totalBytes: 0 };

  const db = getDb();
  const orgId = getOrgId(ctx);
  const { rows } = await sql`
    SELECT
      count(*)::int AS deck_count,
      coalesce(sum(pg_column_size(slides) + pg_column_size(i18n)), 0)::bigint AS total_bytes
    FROM presentations
    WHERE organization_id = ${orgId}
      AND lower(owner_email) = ${owner}
  `.execute(db);

  const row = rows[0] || {};
  return {
    deckCount: Number(row.deck_count) || 0,
    totalBytes: Number(row.total_bytes) || 0,
  };
}

/**
 * Sum stored bytes of every deck in the shared presentations table, scoped to
 * the organization. Used by the cleanup loop's global disk-usage guard.
 * @param {object} ctx - Storage context carrying the organization.
 * @returns {Promise<number>}
 */
export async function getSandboxTotalBytes(ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);
  const { rows } = await sql`
    SELECT coalesce(sum(pg_column_size(slides) + pg_column_size(i18n)), 0)::bigint AS total_bytes
    FROM presentations
    WHERE organization_id = ${orgId}
  `.execute(db);
  return Number(rows[0]?.total_bytes) || 0;
}

/**
 * Throw {@link SandboxQuotaError} when minting one more deck for `ownerEmail`
 * would exceed the per-guest deck-count cap, or the guest's stored bytes are
 * already over the per-guest byte cap. No-op outside sandbox mode or without an
 * owner email, so it is safe to call unconditionally from the create path.
 * @param {object} ctx - Storage context carrying the organization.
 * @param {string} ownerEmail
 * @returns {Promise<void>}
 */
export async function assertSandboxQuotaForCreate(ctx, ownerEmail) {
  if (!sandboxEnabled()) return;
  const owner = normalizeEmail(ownerEmail);
  if (!owner) return;

  const maxDecks = sandboxMaxDecksPerGuest();
  const maxBytes = sandboxMaxBytesPerGuest();
  const { deckCount, totalBytes } = await getSandboxUsageForOwner(ctx, owner);

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
