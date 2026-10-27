import { execFileSync } from 'node:child_process';
const UNIT = 'deckyard-render-broker.service';
function systemctl(...args) {
  return execFileSync('/usr/bin/systemctl', args, {
    encoding: 'utf8',
    timeout: 1500,
  }).trim();
}
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
  return Object.fromEntries(
    systemctl('show', unit, ...names.flatMap((n) => ['-p', n]))
      .split('\n')
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

/** Only the supervisor may request these fixed lifecycle actions. */
export function startBrokerService() {
  systemctl('start', '--no-block', UNIT);
}
export function stopBrokerService() {
  systemctl('stop', UNIT);
}

export function brokerProperties() {
  return properties(UNIT);
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
