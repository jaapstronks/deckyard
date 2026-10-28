import { execFile, execFileSync } from 'node:child_process';
const UNIT = 'deckyard-render-broker.service';
const BROKER_CGROUP = `/system.slice/${UNIT}`;
// Off the accept path only: under boot load PID 1 can take seconds to answer.
const ASYNC_TIMEOUT = 15000;
function systemctl(...args) {
  return execFileSync('/usr/bin/systemctl', args, {
    encoding: 'utf8',
    timeout: 1500,
  }).trim();
}
function systemctlAsync(...args) {
  return new Promise((resolve, reject) =>
    execFile(
      '/usr/bin/systemctl',
      args,
      { encoding: 'utf8', timeout: ASYNC_TIMEOUT },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    ),
  );
}
function parseShow(text) {
  return Object.fromEntries(
    text.split('\n').map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
  );
}
const LAUNCH_STATE = [
  'ActiveState',
  'Job',
  'MainPID',
  'InvocationID',
  'ControlGroup',
  'Result',
  'ExecMainStatus',
];
function properties(unit) {
  const names = [
    'MainPID',
    'InvocationID',
    'ControlGroup',
    'Restart',
    'RestartForceExitStatus',
    'TriggeredBy',
    'DropInPaths',
    'FragmentPath',
    'SystemCallFilter',
    'SystemCallArchitectures',
    'SystemCallErrorNumber',
  ];
  return parseShow(systemctl('show', unit, ...names.flatMap((n) => ['-p', n])));
}

/** Only the supervisor may request these fixed lifecycle actions. */
export function startBrokerService() {
  systemctl('start', '--no-block', UNIT);
}
export function stopBrokerService() {
  systemctl('stop', UNIT);
}
/** Ask systemd to stop the broker without waiting: systemd signals the unit's
 * own main process, so the supervisor never signals a pid it may have lost. */
export function requestBrokerStop() {
  systemctl('stop', '--no-block', UNIT);
}

export function brokerProperties() {
  return properties(UNIT);
}
/** The broker unit's launch state, without blocking the supervisor's loop:
 * the lifecycle accept path and the pre-registration watch both use it. */
export async function brokerLaunchState() {
  return parseShow(
    await systemctlAsync(
      'show',
      UNIT,
      ...LAUNCH_STATE.flatMap((n) => ['-p', n]),
    ),
  );
}
export function supervisorProperties() {
  return properties('deckyard-render-supervisor.service');
}

/** Reject stale loaded policy as well as unknown drop-ins. These denials must
 * precede Node initialization, including its shared libuv threadpool. */
export function assertProducerPolicy(properties) {
  const expected = [
    'io_setup',
    'io_submit',
    'io_getevents',
    'io_pgetevents',
    'io_cancel',
    'io_destroy',
    'io_uring_setup',
    'io_uring_enter',
    'io_uring_register',
  ];
  const filter = properties.SystemCallFilter;
  if (
    properties.DropInPaths ||
    !filter.startsWith('~') ||
    JSON.stringify(filter.slice(1).trim().split(/\s+/).sort()) !==
      JSON.stringify(expected.sort()) ||
    properties.SystemCallArchitectures !== 'native' ||
    properties.SystemCallErrorNumber !== '1'
  )
    throw new Error('producer syscall policy unavailable');
}

/** The first condition a lifecycle peer fails, or null when it is the broker
 * unit's main process. Pure: the caller gathers the facts and logs the name,
 * so a refused peer is visible in the journal (runner iteration 5).
 * @param {{ uid: number, pid: number }} peer
 * @param {Record<string, string>} state  `brokerLaunchState()`
 * @param {string|null} procCgroup  trimmed `/proc/<pid>/cgroup`, null if gone
 * @param {boolean} exited  the peer's pidfd reports exit
 * @param {boolean} registered  the supervisor already holds an instance
 */
export function brokerPeerRefusal(peer, state, procCgroup, exited, registered) {
  if (peer.uid !== 0) return 'peer_uid';
  if (registered) return 'instance_registered';
  if (String(peer.pid) !== state.MainPID) return 'main_pid';
  if (!state.InvocationID) return 'invocation_id';
  if (state.ControlGroup !== BROKER_CGROUP) return 'control_group';
  if (procCgroup !== `0::${BROKER_CGROUP}`) return 'proc_cgroup';
  if (exited) return 'peer_exited';
  return null;
}
