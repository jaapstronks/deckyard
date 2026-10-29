/** Delays before each relaunch of a broker that ended unregistered. After the
 * last one the supervisor stops trying until an operator restarts it. */
export const RELAUNCH_DELAYS = [1000, 2000, 4000, 8000, 16000];
const POLL = 500;
/** How long a launched broker may stay `active` without registering before
 * the watch reports it once (it keeps watching). */
export const REGISTRATION_OVERDUE = 30000;

/**
 * The supervisor's only way to start a broker. A launched invocation is
 * watched until it registers; when the unit settles in `failed` or `inactive`
 * with no job queued and nothing registered, it logs `broker_not_registered`
 * and launches again after a bounded backoff, then `broker_launch_blocked`
 * once. A launch that stays `active` without registering is reported once as
 * `broker_registration_overdue`. `Restart=no` stays the unit's policy: this is
 * the supervisor deciding, after the same activation-policy check, not systemd.
 *
 * Pure apart from its arguments, so the state machine is testable without
 * systemd (`tests/renderer-runner-lifecycle.test.js`).
 * @param {{
 *   start: () => void,
 *   stopUnit?: () => void,
 *   state: () => Promise<Record<string, string>>,
 *   busy: () => boolean,
 *   log: (phase: string, detail?: object) => void,
 *   delays?: number[],
 *   poll?: number,
 *   overdue?: number,
 * }} options
 * `busy()` is true while the supervisor holds an instance or retires one;
 * the watch then ends (registered) or waits (retiring).
 */
export function brokerLauncher({
  start,
  stopUnit,
  state,
  busy,
  log,
  delays = RELAUNCH_DELAYS,
  poll = POLL,
  overdue = REGISTRATION_OVERDUE,
}) {
  let watching = false,
    attempts = 0,
    launches = 0,
    timer = null,
    stopped = false,
    activeSince = null,
    reported = false;
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
      // Active with nothing queued and still no registration: a broker that
      // hangs before its lifecycle connect. Named once; the watch goes on.
      if (unit.ActiveState === 'active' && !unit.Job) {
        activeSince ??= performance.now();
        const activeMs = Math.round(performance.now() - activeSince);
        if (!reported && activeMs >= overdue) {
          reported = true;
          log('broker_registration_overdue', { activeMs });
        }
      }
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
    activeSince = null;
    reported = false;
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
    /** After a retirement: stop the old broker unit, then launch its
     * successor (`restart`) or report that the self-test is not ready. Nothing
     * after `stop()`: the stopping supervisor kills its broker itself, and
     * systemd refuses broker jobs while it stops the supervisor, which would
     * otherwise surface as a false operator alarm. */
    retired(restart) {
      if (stopped) return;
      stopUnit();
      if (restart) launch();
      else log('self_test_not_ready');
    },
    /** Supervisor shutdown: no further launch, query or unit job. */
    stop() {
      stopped = true;
      watching = false;
      clearTimeout(timer);
      timer = null;
    },
    /** True once the supervisor stops; its failures are no operator signal. */
    get stopped() {
      return stopped;
    },
  };
}
