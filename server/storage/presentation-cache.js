/**
 * Short-TTL read cache for presentations, used on audience-facing hot paths
 * (follow status ticks, interaction state/vote handlers).
 *
 * Those paths only need near-fresh data, but were re-reading and re-parsing
 * the full deck per request/tick, so server load scaled with
 * followers × deck size. Writes invalidate via invalidatePresentationCache()
 * (called from the presentations facade); the TTL bounds staleness for any
 * write path that misses invalidation.
 */

const TTL_MS = 2000;
const MAX_ENTRIES = 200;

/** @type {Map<string, { at: number, promise: Promise<any> }>} */
const cache = new Map();

function cacheKey(repoRoot, id) {
  return `${String(repoRoot || '')}\n${String(id || '')}`;
}

function sweep(nowTs) {
  if (cache.size <= MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (nowTs - entry.at >= TTL_MS) cache.delete(key);
  }
}

/**
 * Get a presentation through the short-TTL cache.
 * Concurrent callers share a single in-flight load.
 * @param {string} repoRoot
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function getPresentationCached(repoRoot, id) {
  const key = cacheKey(repoRoot, id);
  const nowTs = Date.now();
  const hit = cache.get(key);
  if (hit && nowTs - hit.at < TTL_MS) return hit.promise;
  // Dynamic import keeps this module free of a static cycle with the facade,
  // which imports invalidatePresentationCache from here.
  const promise = import('./presentations.js')
    .then((mod) => mod.getPresentation(repoRoot, id))
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, { at: nowTs, promise });
  sweep(nowTs);
  return promise;
}

/**
 * Drop cached entries for a presentation id (across repo roots), or all
 * entries when no id is given.
 * @param {string|null} [id]
 */
export function invalidatePresentationCache(id = null) {
  if (id == null) {
    cache.clear();
    return;
  }
  const suffix = `\n${String(id)}`;
  for (const key of cache.keys()) {
    if (key.endsWith(suffix)) cache.delete(key);
  }
}
