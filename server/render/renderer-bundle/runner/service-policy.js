import { execFileSync } from 'node:child_process';
const UNIT = 'deckyard-render-broker.service';
function systemctl(...args) {
  return execFileSync('/usr/bin/systemctl', args, {
    encoding: 'utf8',
    timeout: 1500,
  }).trim();
}
export function brokerProperties() {
  const names = [
    'MainPID',
    'InvocationID',
    'ControlGroup',
    'Restart',
    'RestartForceExitStatus',
    'TriggeredBy',
    'DropInPaths',
    'FragmentPath',
  ];
  return Object.fromEntries(
    systemctl('show', UNIT, ...names.flatMap((n) => ['-p', n]))
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
