/**
 * Reconnecting-stream lifecycle with exponential backoff.
 *
 * Every long-lived stream in the client (notification SSE, the two Q&A
 * streams, the notes session stream) needs the same three things: reopen after
 * a drop, back off so a wedged server isn't hammered, and — the part that used
 * to be hand-rolled and forgotten — *cancel the pending reopen* when the view
 * that owns the stream goes away. A retry scheduled with a bare
 * `setTimeout(connect, N)` survives teardown and opens a connection nothing can
 * ever close, which then reschedules itself forever.
 *
 * Owning the timer here means teardown is a single `stop()`.
 *
 * @param {(cbs: {onOpen: Function, onError: Function, onDone: Function}) => (Function|void)} connectFn
 *   Opens the connection and returns a cleanup function that closes it.
 *   Call `onOpen` once the stream is live (resets the backoff), `onError` when
 *   it drops (schedules a reopen), and `onDone` when the peer closed for good
 *   (stops without reopening).
 * @param {object} [options]
 * @param {(s: {kind: 'connecting'|'open'|'error'|'done', attempt?: number}) => void} [options.onStatus]
 * @param {number} [options.baseDelayMs=600] First retry delay.
 * @param {number} [options.maxDelayMs=30000] Ceiling for the doubling delay.
 * @returns {{start: Function, stop: Function, isRunning: boolean}}
 */
export function withBackoff(
  connectFn,
  { onStatus, baseDelayMs = 600, maxDelayMs = 30_000 } = {}
) {
  let stopped = true;
  let attempt = 0;
  let generation = 0;
  let currentCleanup = null;
  let retryTid = null;

  const clearRetry = () => {
    if (retryTid) {
      clearTimeout(retryTid);
      retryTid = null;
    }
  };

  const closeCurrent = () => {
    const fn = currentCleanup;
    currentCleanup = null;
    if (typeof fn !== 'function') return;
    try {
      fn();
    } catch {
      // closing a dead stream is best-effort
    }
  };

  const stop = () => {
    stopped = true;
    attempt = 0;
    generation += 1;
    clearRetry();
    closeCurrent();
  };

  const schedule = () => {
    if (stopped) return;
    clearRetry();
    if (attempt === 0) {
      open();
      return;
    }
    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    retryTid = setTimeout(() => {
      retryTid = null;
      open();
    }, delay);
    retryTid?.unref?.();
  };

  function open() {
    if (stopped) return;
    // Callbacks from a superseded attempt must not steer the current one — a
    // connectFn is free to fire onError synchronously, which reopens before
    // this call has even returned its cleanup.
    const myGen = ++generation;
    const isCurrent = () => myGen === generation && !stopped;
    attempt += 1;
    onStatus?.({ kind: 'connecting', attempt });

    let cleanup = null;
    try {
      cleanup =
        connectFn({
          onOpen: () => {
            if (!isCurrent()) return;
            attempt = 0;
            onStatus?.({ kind: 'open' });
          },
          onError: () => {
            if (!isCurrent()) return;
            onStatus?.({ kind: 'error' });
            closeCurrent();
            schedule();
          },
          onDone: () => {
            if (!isCurrent()) return;
            onStatus?.({ kind: 'done' });
            stop();
          },
        }) || null;
    } catch {
      onStatus?.({ kind: 'error' });
      schedule();
      return;
    }

    if (!isCurrent()) {
      // stop() or a synchronous callback moved on while connectFn ran; this
      // connection is already orphaned, so close it here.
      if (typeof cleanup === 'function') {
        try {
          cleanup();
        } catch {
          // ignore
        }
      }
      return;
    }
    currentCleanup = cleanup;
  }

  return {
    /** Open the stream (no-op while already running). */
    start: () => {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      schedule();
    },
    /** Close the stream and cancel any pending reopen. Safe to call twice. */
    stop,
    get isRunning() {
      return !stopped;
    },
  };
}
