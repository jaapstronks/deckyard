/**
 * Bounded-concurrency async helpers for export/render image embedding.
 *
 * The PDF/PNG/HTML export paths inline remote images (fetch + sharp
 * recompress) one at a time; on decks with dozens of remote images that
 * sequential wait dominates wall-clock and can tip a large deck past the
 * export timeout. `mapLimit` runs the per-image work concurrently at a
 * bounded limit while preserving result order.
 */

/**
 * Map over items with bounded concurrency, preserving result order.
 * A rejecting `fn` rejects the whole call (matches `Promise.all` semantics),
 * so callers keep their existing try/catch behaviour.
 *
 * @template T, R
 * @param {T[]} items - Items to process
 * @param {number} limit - Max concurrent `fn` invocations (coerced to >= 1)
 * @param {(item: T, index: number) => Promise<R>} fn - Async worker
 * @returns {Promise<R[]>} Results in the same order as `items`
 */
export async function mapLimit(items, limit, fn) {
  const arr = Array.isArray(items) ? items : [];
  const n = arr.length;
  const results = new Array(n);
  if (n === 0) return results;
  const max = Math.max(1, Math.min(Math.floor(limit) || 1, n));
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= n) return;
      results[i] = await fn(arr[i], i);
    }
  }
  await Promise.all(Array.from({ length: max }, () => worker()));
  return results;
}

/**
 * Concurrency limit for image embedding during export/render.
 * Overridable via EXPORT_EMBED_CONCURRENCY; defaults to 8.
 * @returns {number} A positive integer concurrency limit
 */
export function exportEmbedConcurrency() {
  const raw = Number.parseInt(process.env.EXPORT_EMBED_CONCURRENCY || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 8;
}
