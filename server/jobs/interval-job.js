/**
 * createIntervalJob — the shared interval-lifecycle plumbing every scheduled
 * job in `server/jobs/` used to hand-roll: create the timer, `unref` it so it
 * never keeps the process alive on its own, and hand back an idempotent
 * `{ stop() }`.
 *
 * It owns ONLY the timer lifecycle. Everything job-specific stays in the
 * caller — the re-entrancy guard, the immediate-first-run logging, the
 * enabled/no-op short-circuit, the minimum-interval floor — because those
 * differ per job, and folding them in would turn a primitive into a config bag.
 * A caller that needs a floor passes an already-floored `intervalMs`; a caller
 * with extra teardown wraps the returned handle's `stop()`.
 *
 * This is the single place `setInterval` is allowed under `server/jobs/`; the
 * guard in `tests/jobs-interval-lifecycle-gate.test.js` fails on any other.
 *
 * @param {() => (void | Promise<void>)} task - Work to run each tick. Error
 *   handling is the task's own responsibility (every caller already wraps its
 *   body in try/catch); a rejected promise here is unhandled, exactly as it was
 *   when the jobs called `setInterval(task, …)` directly.
 * @param {object} options
 * @param {number} options.intervalMs - Tick interval in milliseconds.
 * @param {boolean} [options.immediate=false] - Run `task()` once (fire and
 *   forget) before scheduling the interval, mirroring the `runJob()`/`sweep()`
 *   call the jobs made on start so a crash's backlog is collected immediately.
 * @returns {{ stop: () => void }} Idempotent handle; `stop()` clears the timer.
 */
export function createIntervalJob(task, { intervalMs, immediate = false } = {}) {
  if (immediate) task();

  let intervalId = setInterval(task, intervalMs);
  intervalId.unref?.(); // Don't keep the process alive just for this timer.

  return {
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}
