/**
 * The `details` register for the internal error envelope.
 *
 * `{ ok:false, error, message?, details? }` is a **tagged union**: `error` is
 * the discriminator and `details` the payload that code carries (D78). It is
 * not an open bag — a code either appears below with the keys it may send, or
 * it sends no `details` at all. Prose never rides in `details`; that is what
 * `message` is for.
 *
 * Two families:
 *
 * - **The location shape** (`LOCATION_KEYS`) — what every storage refusal
 *   carries, via `storageError()`: which input was bad (`field`), where in a
 *   list (`index`, `itemIndex`) and a snake_case sub-code for the problem
 *   there (`reason`). Allowed for any code in the `REASONS` register.
 * - **The payload shapes** (`PAYLOAD_KEYS`) — one per code, listed below:
 *   `held` sends the competing slide lock (`lock`); `conflict` the server copy
 *   a stale `If-Match` lost against (`id`, `revision`, `modified`,
 *   `updatedBy`, plus `conflictingSlides` when the slide-level merge is what
 *   failed); `locked` which slide and who holds it (`slideId`,
 *   `lockKind`, `holder`); `conversion_failed` the same `report` the 201 body
 *   and the SSE stream carry; `maintenance` the object `GET /api/maintenance`
 *   returns (`active`, `reason`, `retryAfter`); `sandbox_quota_exceeded` the
 *   quota that was hit (`resource`, `limit`, `used`).
 *
 * Enforcement sits at the two emission points that know the code —
 * `jsonError()` (`server/utils/http.js`) and `AppError.toJSON()`
 * (`server/utils/errors.js`) — and follows `getErrorStatus`'s posture (B104):
 * a violation **throws outside production** and is **let through unchanged in
 * production**, because a contract slip made in development must never turn a
 * running instance's 4xx into a 500.
 *
 * The register **permits** keys, it does not require them: a code sends the
 * subset it has (a `locked` without a `holder`, a `conflict` that is not a
 * merge conflict). What it may never send is a key nobody registered.
 *
 * Shape and meaning per code: `docs/reference/api-error-format.md` § `details`.
 *
 * @module server/utils/error-details
 */

import { reasonEntry } from '../storage/reasons.js';

/**
 * The keys a storage refusal may put on the wire — see `locateDetails()` in
 * `server/utils/http.js`, which is the only producer. Allowed for every code
 * in the `REASONS` register, and only for those.
 * @type {readonly string[]}
 */
export const LOCATION_KEYS = Object.freeze([
  'field',
  'index',
  'itemIndex',
  'reason',
]);

/**
 * The permitted `details` keys per error code. A code that is absent here (and
 * is not a storage reason) sends no `details`.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const PAYLOAD_KEYS = Object.freeze({
  held: Object.freeze(['lock']),
  conflict: Object.freeze([
    'id',
    'revision',
    'modified',
    'updatedBy',
    'conflictingSlides',
  ]),
  locked: Object.freeze(['slideId', 'lockKind', 'holder']),
  conversion_failed: Object.freeze(['report']),
  maintenance: Object.freeze(['active', 'reason', 'retryAfter']),
  sandbox_quota_exceeded: Object.freeze(['resource', 'limit', 'used']),
});

/** @returns {boolean} Whether a register violation should throw. */
function throwOnViolation() {
  return process.env.NODE_ENV !== 'production';
}

/**
 * The keys `code` may send, or `null` when it may send no `details` at all.
 * A storage reason that also has a payload entry (`locked` is both a 409
 * storage reason and the 423 `LockedError`) may send either family.
 * @param {string} code
 * @returns {Set<string>|null}
 */
function allowedKeys(code) {
  const payload = PAYLOAD_KEYS[code];
  const isReason = typeof code === 'string' && Boolean(reasonEntry(code));
  if (!payload && !isReason) return null;
  return new Set([...(payload || []), ...(isReason ? LOCATION_KEYS : [])]);
}

/**
 * Check `details` against the register for `code`, throwing outside production.
 *
 * Absent `details` always passes. Present `details` must be a plain object
 * (never a string, never an array) whose every key the code is registered for.
 *
 * @param {string} code - The envelope's machine code (the discriminator).
 * @param {*} details - The `details` value about to go on the wire.
 * @returns {void}
 * @throws {Error} Outside production, when `details` violates the register.
 */
export function assertErrorDetails(code, details) {
  if (details == null) return;
  const violation = describeViolation(code, details);
  if (!violation) return;
  if (throwOnViolation()) throw new Error(violation);
  // In production the response goes out unchanged: a contract slip is a bug to
  // fix, not a reason to fail a request that otherwise answers correctly.
}

/**
 * @param {string} code
 * @param {*} details
 * @returns {string|null} The violation, or `null` when `details` is legal.
 */
function describeViolation(code, details) {
  const where =
    `details on error ${JSON.stringify(code)} — the register is ` +
    'PAYLOAD_KEYS in server/utils/error-details.js ' +
    '(docs/reference/api-error-format.md § details).';

  if (typeof details !== 'object' || Array.isArray(details)) {
    return (
      `Non-object ${where} \`details\` is always a flat object; a sentence ` +
      'belongs in `message`, a list under a named key.'
    );
  }

  const allowed = allowedKeys(code);
  if (!allowed) {
    return (
      `Unregistered ${where} This code carries no payload: put the text in ` +
      '`message`, or register the code with the keys it needs.'
    );
  }

  const stray = Object.keys(details).filter((k) => !allowed.has(k));
  if (stray.length) {
    return (
      `Unregistered key${stray.length > 1 ? 's' : ''} ` +
      `${stray.map((k) => JSON.stringify(k)).join(', ')} in ${where} ` +
      `Registered: ${[...allowed].join(', ')}.`
    );
  }
  return null;
}
