/**
 * The refusals a render bundle can produce, as machine codes.
 *
 * Every one of these is a *refusal*, never a fallback. A published edition that
 * names a renderer this installation does not have, or whose bytes do not hash
 * to what the manifest says, renders nothing at all: falling back to the
 * current renderer would serve different content under a citation, which is the
 * whole thing the edition record exists to prevent
 * (`docs/plans/briefs/publication-records.md` § Bevroren rendercontract).
 *
 * Pure and dependency-free on purpose: the bundle's own entry throws these from
 * inside the proof worker, so this module has to be bundle-safe.
 */

/** Closed set of refusal codes. */
export const RENDERER_BUNDLE_ERRORS = Object.freeze({
  /** No bundle with this hash in the store. */
  UNKNOWN: 'renderer_bundle_unknown',
  /** The hash is not a 64-char hex digest. */
  MALFORMED_HASH: 'renderer_bundle_malformed_hash',
  /** Manifest or a file does not hash to what the manifest says. */
  CORRUPT: 'renderer_bundle_corrupt',
  /** A file the manifest names is missing, or one it does not name is present. */
  INCOMPLETE: 'renderer_bundle_incomplete',
  /** Production execution awaits runner acceptance and separate activation. */
  SANDBOX_UNAVAILABLE: 'renderer_bundle_sandbox_unavailable',
  /** The worker died, timed out, or wrote something unreadable. */
  WORKER_FAILED: 'renderer_bundle_worker_failed',
  /** The edition input does not match the schema the entry accepts. */
  INPUT_INVALID: 'renderer_edition_input_invalid',
  /**
   * The edition carries a dependency this renderer cannot close: today, author
   * markup that would need the HTML sanitizer, whose `jsdom`/`dompurify` are
   * outside the bundle. Refusing is the documented advice for an unsealable
   * dependency; rendering it unsanitised or silently escaped is not.
   */
  UNSEALABLE_INPUT: 'renderer_edition_input_unsealable',
});

/** An error carrying one of {@link RENDERER_BUNDLE_ERRORS}. */
export class RendererBundleError extends Error {
  /**
   * @param {string} code - One of RENDERER_BUNDLE_ERRORS
   * @param {string} message - Human-readable detail
   * @param {object|null} [details] - Structured detail for a log line
   */
  constructor(code, message, details = null) {
    super(message);
    this.name = 'RendererBundleError';
    this.code = code;
    this.details = details;
  }
}
