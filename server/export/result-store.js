/**
 * Finished export files, held in memory until their owner downloads them.
 *
 * Two producers hand a file over this way, because neither can put it in the
 * response that asked for it: the queued export worker (the request answered
 * `202` long before) and the streamed export (`/export/<fmt>/stream`, whose
 * response is an event stream). Both are read back through
 * `GET /api/jobs/export-<id>/download`, which enforces `ownerEmail`
 * (security-audit H3).
 *
 * A streamed result is taken by its one download: the client fetches it the
 * moment the stream says `complete`, and a 600 MB handoff ZIP has no business
 * sitting in memory for the rest of the hour.
 */

/** How long a queued export waits for its download. */
export const EXPORT_RESULT_TTL_MS = 60 * 60 * 1000;

/** How long a streamed export waits for the download its client starts at once. */
export const STREAM_RESULT_TTL_MS = 10 * 60 * 1000;

/**
 * @typedef {Object} ExportResult
 * @property {Buffer} buffer - the file
 * @property {string} contentType
 * @property {string} extension
 * @property {string} filename - without extension or language suffix
 * @property {string} [langSuffix]
 * @property {string|null} ownerEmail - who may download it
 * @property {Record<string, string>} [headers] - extra response headers, a
 *   finding about the file the file cannot carry (the editable PPTX's image
 *   slides)
 * @property {boolean} [once] - drop the result after its first download
 */

/** @type {Map<string, { result: ExportResult, expiresAt: number }>} */
const results = new Map();

/**
 * Hold a finished export for download.
 *
 * @param {string} id - the id after `export-` in the download URL
 * @param {ExportResult} result
 * @param {{ ttlMs?: number }} [opts]
 */
export function storeExportResult(
  id,
  result,
  { ttlMs = EXPORT_RESULT_TTL_MS } = {},
) {
  results.set(id, { result, expiresAt: Date.now() + ttlMs });
  // Unref'd so it never keeps the process alive.
  setTimeout(() => results.delete(id), ttlMs).unref();
}

/**
 * The stored export under `id`, or null when absent or expired.
 *
 * @param {string} id
 * @returns {ExportResult|null}
 */
export function getExportResult(id) {
  const entry = results.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    results.delete(id);
    return null;
  }
  return entry.result;
}

/**
 * Forget a result once its download went out, when it asked for that.
 *
 * @param {string} id
 */
export function releaseExportResult(id) {
  if (results.get(id)?.result.once) results.delete(id);
}
