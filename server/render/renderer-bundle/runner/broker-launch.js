/** Delays before each relaunch of a broker that ended unregistered. After the
 * last one the supervisor stops trying until an operator restarts it. */
export const RELAUNCH_DELAYS = [1000, 2000, 4000, 8000, 16000];
const POLL = 500;

/**
 * The supervisor's only way to start a broker. A launched invocation is
 * watched until it registers; when the unit settles in `failed` or `inactive`
 * with no job queued and nothing registered, it logs `broker_not_registered`
 * and launches again after a bounded backoff, then `broker_launch_blocked`
 * once. `Restart=no` stays the unit's policy: this is the supervisor deciding,
 * after the same activation-policy check, not systemd.
 *
 * Pure apart from its arguments, so the state machine is testable without
 * systemd (`tests/renderer-runner-launch.test.js`).
 * @param {{
 *   start: () => void,
 *   state: () => Promise<Record<string, string>>,
 *   busy: () => boolean,
 *   log: (phase: string, detail?: object) => void,
 *   delays?: number[],
 *   poll?: number,
 * }} options
 * `busy()` is true while the supervisor holds an instance or retires one;
 * the watch then ends (registered) or waits (retiring).
 */
export function brokerLauncher({
  start,
  state,
  busy,
  log,
  delays = RELAUNCH_DELAYS,
  poll = POLL,
}) {
  let watching = false,
    attempts = 0,
    launches = 0,
    timer = null,
    stopped = false;
  function schedule(fn, ms) {
    clearTimeout(timer);
    timer = stopped ? null : setTimeout(fn, ms);
  }
  async function check() {
    timer = null;
    if (!watching || stopped) return;
    const seen = launches;
    let unit;
    try {
      unit = await state();
    } catch {
      // A slow or failed query is not a verdict; ask again.
      if (seen === launches) schedule(check, poll);
      return;
    }
    // A newer launch watches itself; this answer may predate its start.
    if (!watching || stopped || busy() || seen !== launches) return;
    if (unit.Job || !['failed', 'inactive'].includes(unit.ActiveState)) {
      schedule(check, poll);
      return;
    }
    log('broker_not_registered', {
      result: unit.Result,
      status: unit.ExecMainStatus,
      attempt: attempts,
    });
    if (attempts >= delays.length) {
      watching = false;
      log('broker_launch_blocked');
      return;
    }
    schedule(() => {
      if (watching && !busy()) launch();
    }, delays[attempts++]);
  }
  /** Start the broker unit and watch it until it registers. */
  function launch() {
    if (stopped) return;
    watching = true;
    launches++;
    try {
      start();
    } catch {
      // Not enqueued: the unit stays failed or inactive and the watch counts
      // it as an unregistered launch.
      log('broker_start_failed');
    }
    schedule(check, poll);
  }
  return {
    launch,
    /** The launched broker registered: end the watch, reset the backoff. */
    registered() {
      watching = false;
      attempts = 0;
      clearTimeout(timer);
      timer = null;
    },
    /** Supervisor shutdown: no further launch or query. */
    stop() {
      stopped = true;
      watching = false;
      clearTimeout(timer);
      timer = null;
    },
  };
}
