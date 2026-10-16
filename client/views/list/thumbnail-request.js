/**
 * The deck card's side of the thumbnail contract
 * (docs/reference/deck-thumbnails.md): ask, wait when the server says so, show
 * what comes back.
 *
 * The raster is fetched rather than set as an `<img src>`, because an image
 * element cannot read the 404 envelope: it sees "error" for "still rendering"
 * and for "will never render" alike, which is what made the card guess with
 * timers. The browser cache still applies, ETag and 304 included.
 */

/** How often a card asks again while the server answers `thumbnail_pending`. */
export const THUMB_PENDING_RETRIES = 2;

/** Wait when a pending answer names none, and the cap on what it may name. */
const DEFAULT_WAIT_S = 3;
const MAX_WAIT_S = 10;

/**
 * Fetch a deck's slide-1 raster.
 *
 * @param {string} deckId
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - Aborts the fetch and any wait.
 * @param {typeof fetch} [options.fetchImpl] - Test seam.
 * @param {(ms: number, signal?: AbortSignal) => Promise<boolean>} [options.wait]
 *   Test seam: resolves true after `ms`, false when aborted first.
 * @returns {Promise<{ blob: Blob } | { placeholder: true } | null>} the raster,
 *   the instruction to show the placeholder, or null when aborted.
 */
export async function requestDeckThumbnail(
  deckId,
  { signal, fetchImpl = globalThis.fetch, wait = abortableWait } = {},
) {
  const url = `/api/presentations/${encodeURIComponent(deckId)}/thumbnail`;
  const giveUp = () => (signal?.aborted ? null : { placeholder: true });
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { credentials: 'same-origin', signal });
      if (res.ok) return { blob: await res.blob() };
    } catch {
      return giveUp();
    }
    const body = await res.json().catch(() => null);
    if (body?.error !== 'thumbnail_pending') return giveUp();
    if (attempt >= THUMB_PENDING_RETRIES) return giveUp();
    if (!(await wait(retryAfterMs(res), signal))) return null;
  }
}

/**
 * The wait a pending answer asks for, in ms, bounded.
 * @param {Response} res
 * @returns {number}
 */
function retryAfterMs(res) {
  const seconds = Number(res.headers?.get?.('Retry-After'));
  const bounded =
    Number.isFinite(seconds) && seconds > 0
      ? Math.min(seconds, MAX_WAIT_S)
      : DEFAULT_WAIT_S;
  return bounded * 1000;
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>} true after `ms`, false when aborted first.
 */
function abortableWait(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(id);
      resolve(false);
    };
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
