/**
 * Auto-advance / pacing timer engine for timed slides.
 *
 * Uses requestAnimationFrame for smooth 60fps countdown ticks.
 * Pauses automatically when the tab is hidden (battery friendly).
 *
 * Modes:
 *   - 'auto' (default): advances slides automatically when timer expires.
 *   - 'pacing': visual-only timer. Fires onTimerExpired once at 100%, then
 *     keeps running (progress > 1) so the UI can show overtime state.
 *
 * Usage:
 *   const aa = createAutoAdvance({
 *     onAdvance: () => deckCtl.next(),
 *     onTick: (progress) => { ... },           // 0..1 (or >1 in pacing overtime)
 *     onStateChange: (state) => { ... },        // 'running' | 'paused' | 'stopped'
 *     onLoopComplete: () => deckCtl.show(0),
 *     onTimerExpired: () => { ... },            // pacing mode: fires once at 100%
 *   });
 *   aa.configure({
 *     intervalSeconds: 20,
 *     loop: true,
 *     mode: 'pacing',
 *     getSlideInterval: (idx) => seconds,
 *   });
 *   aa.start();
 */

export function createAutoAdvance({
  onAdvance,
  onTick,
  onStateChange,
  onLoopComplete,
  onTimerExpired,
} = {}) {
  let intervalMs = 20_000;
  let loop = false;
  let mode = 'auto'; // 'auto' | 'pacing'
  let getSlideInterval = null; // (idx) => seconds, or null
  let state = 'stopped'; // 'running' | 'paused' | 'stopped'
  let startTime = 0;
  let elapsed = 0; // ms already elapsed before last pause
  let rafId = null;
  let isLastSlide = false;
  let currentIndex = 0;
  let timerExpiredFired = false; // pacing: only fire onTimerExpired once per slide

  function setState(s) {
    if (state === s) return;
    state = s;
    onStateChange?.(s);
  }

  /** Resolve the interval for the current slide index. */
  function resolveIntervalMs() {
    if (typeof getSlideInterval === 'function') {
      const sec = getSlideInterval(currentIndex);
      if (typeof sec === 'number' && Number.isFinite(sec) && sec >= 1) {
        return Math.min(300_000, Math.max(1000, sec * 1000));
      }
    }
    return intervalMs;
  }

  function tick() {
    if (state !== 'running') return;
    const now = performance.now();
    const total = elapsed + (now - startTime);
    const currentIntervalMs = resolveIntervalMs();
    const progress = total / currentIntervalMs;

    if (mode === 'pacing') {
      // Pacing mode: let progress exceed 1.0 (overtime)
      onTick?.(progress);

      if (progress >= 1 && !timerExpiredFired) {
        timerExpiredFired = true;
        onTimerExpired?.();
      }
      // Keep the RAF loop running so overtime progress updates
      rafId = requestAnimationFrame(tick);
    } else {
      // Auto mode: clamp at 1.0 and advance
      const clamped = Math.min(progress, 1);
      onTick?.(clamped);

      if (clamped >= 1) {
        rafId = null;
        if (isLastSlide && loop) {
          onLoopComplete?.();
        } else if (!isLastSlide) {
          onAdvance?.();
        }
        // If last slide and no loop, just stop.
        // The onSlideChanged call from the navigation callback will restart.
        return;
      }
      rafId = requestAnimationFrame(tick);
    }
  }

  function startRaf() {
    startTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function cancelRaf() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  return {
    /**
     * Configure the timer. Does not start it.
     * @param {{ intervalSeconds?: number, loop?: boolean, mode?: 'auto'|'pacing', getSlideInterval?: Function }} opts
     */
    configure(opts = {}) {
      if (typeof opts.intervalSeconds === 'number') {
        intervalMs = Math.max(1000, Math.min(300_000, opts.intervalSeconds * 1000));
      }
      loop = !!opts.loop;
      mode = opts.mode === 'pacing' ? 'pacing' : 'auto';
      if (typeof opts.getSlideInterval === 'function') {
        getSlideInterval = opts.getSlideInterval;
      }
    },

    /**
     * Start (or restart) the countdown from zero.
     */
    start() {
      cancelRaf();
      elapsed = 0;
      timerExpiredFired = false;
      setState('running');
      onTick?.(0);
      startRaf();
    },

    /**
     * Pause the countdown, preserving elapsed time.
     */
    pause() {
      if (state !== 'running') return;
      cancelRaf();
      const now = performance.now();
      elapsed += now - startTime;
      setState('paused');
    },

    /**
     * Resume from where we paused.
     */
    resume() {
      if (state !== 'paused') return;
      setState('running');
      startRaf();
    },

    /**
     * Toggle between running and paused.
     * If stopped, starts fresh.
     */
    toggle() {
      if (state === 'running') this.pause();
      else if (state === 'paused') this.resume();
      else this.start();
    },

    /**
     * Called when the slide changes (manual nav or auto-advance).
     * Resets and restarts the countdown.
     * @param {number} idx - Current slide index
     * @param {number} total - Total number of slides
     */
    onSlideChanged(idx, total) {
      currentIndex = idx;
      isLastSlide = idx >= total - 1;
      timerExpiredFired = false;
      // Only restart if we were running or paused (not stopped)
      if (state === 'stopped') return;
      cancelRaf();
      elapsed = 0;
      // Keep the same state but restart the timer
      if (state === 'running') {
        onTick?.(0);
        startRaf();
      } else {
        // paused: reset progress but stay paused
        onTick?.(0);
      }
    },

    /**
     * Stop the timer entirely.
     */
    stop() {
      cancelRaf();
      elapsed = 0;
      timerExpiredFired = false;
      setState('stopped');
      onTick?.(0);
    },

    /**
     * Clean up. Call on teardown.
     */
    destroy() {
      cancelRaf();
      state = 'stopped';
    },

    /** @returns {'running' | 'paused' | 'stopped'} */
    getState() {
      return state;
    },

    /** @returns {'auto' | 'pacing'} */
    getMode() {
      return mode;
    },

    /** @returns {boolean} True if in pacing mode and timer has exceeded 100%. */
    isOvertime() {
      return mode === 'pacing' && timerExpiredFired;
    },
  };
}
