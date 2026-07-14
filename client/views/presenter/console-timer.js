/**
 * Presenter stopwatch: elapsed-time tracker independent of auto-advance.
 *
 * Counts up from the moment the presentation begins (or a manual start),
 * supports pause/resume/reset, and an optional target time. When elapsed
 * passes the target the tick reports `overtime: true` so the UI can show a
 * subtle over-time signal.
 *
 * Pure timing logic + a callback; owns a single 1s interval and cleans it up
 * on destroy. No DOM.
 *
 * @param {Object} opts
 * @param {(state: TimerState) => void} [opts.onTick] Called ~1×/second and on
 *   every state change with the current {@link TimerState}.
 * @returns {{
 *   start: () => void,
 *   pause: () => void,
 *   toggle: () => void,
 *   reset: () => void,
 *   setTargetSeconds: (seconds: number|null) => void,
 *   getState: () => TimerState,
 *   destroy: () => void,
 * }}
 *
 * @typedef {Object} TimerState
 * @property {number} elapsedSeconds Whole seconds elapsed.
 * @property {number|null} targetSeconds Target in seconds, or null when unset.
 * @property {boolean} running Whether the stopwatch is currently counting.
 * @property {boolean} started Whether it has been started at least once.
 * @property {boolean} overtime True when a target is set and elapsed exceeds it.
 */
export function createPresenterConsoleTimer({ onTick } = {}) {
  let running = false;
  let started = false;
  // Accumulated ms from previous run segments; the live segment is measured
  // from `segmentStart` while running.
  let accumulatedMs = 0;
  let segmentStart = 0;
  let targetSeconds = null;
  let tid = null;

  const elapsedMs = () =>
    accumulatedMs + (running ? Date.now() - segmentStart : 0);

  const getState = () => {
    const elapsedSeconds = Math.floor(elapsedMs() / 1000);
    return {
      elapsedSeconds,
      targetSeconds,
      running,
      started,
      overtime:
        typeof targetSeconds === 'number' &&
        targetSeconds > 0 &&
        elapsedSeconds >= targetSeconds,
    };
  };

  const emit = () => {
    try {
      onTick?.(getState());
    } catch {
      // ignore listener errors
    }
  };

  const startInterval = () => {
    if (tid) return;
    tid = setInterval(emit, 1000);
    // Don't keep the process alive on the (rare) server-side/test path.
    tid?.unref?.();
  };

  const stopInterval = () => {
    if (!tid) return;
    try {
      clearInterval(tid);
    } catch {
      // ignore
    }
    tid = null;
  };

  const start = () => {
    if (running) return;
    running = true;
    started = true;
    segmentStart = Date.now();
    startInterval();
    emit();
  };

  const pause = () => {
    if (!running) return;
    accumulatedMs = elapsedMs();
    running = false;
    stopInterval();
    emit();
  };

  const toggle = () => {
    if (running) pause();
    else start();
  };

  const reset = () => {
    accumulatedMs = 0;
    segmentStart = Date.now();
    // Keep running if it was running (a "restart"); otherwise stay idle.
    if (!running) {
      started = false;
      stopInterval();
    }
    emit();
  };

  const setTargetSeconds = (seconds) => {
    const n = Number(seconds);
    targetSeconds = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    emit();
  };

  const destroy = () => {
    stopInterval();
  };

  return {
    start,
    pause,
    toggle,
    reset,
    setTargetSeconds,
    getState,
    destroy,
  };
}

/**
 * Format a whole-second count as `M:SS` (or `H:MM:SS` past an hour).
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(mins)}:${pad(secs)}`;
  return `${mins}:${pad(secs)}`;
}

/**
 * Parse a user-typed target time into whole seconds.
 * Accepts `"20"` (minutes), `"20:00"` / `"1:05:00"` (colon-separated), or a
 * bare number of minutes. Returns null when empty/invalid.
 * @param {string} raw
 * @returns {number|null}
 */
export function parseTargetToSeconds(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => Number(p.trim()));
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    let seconds = 0;
    for (const p of parts) seconds = seconds * 60 + p;
    return seconds > 0 ? Math.round(seconds) : null;
  }
  const mins = Number(str);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return Math.round(mins * 60);
}
