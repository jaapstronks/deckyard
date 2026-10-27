import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
export function populated(directory) {
  if (!existsSync(directory)) return false;
  return !readFileSync(`${directory}/cgroup.events`, 'utf8')
    .split('\n')
    .includes('populated 0');
}
export function kill(directory) {
  if (existsSync(directory)) writeFileSync(`${directory}/cgroup.kill`, '1');
}
export function groupsBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => [
      ...groupsBelow(`${directory}/${e.name}`),
      `${directory}/${e.name}`,
    ]);
}
export function limits(directory, memory, pids) {
  mkdirSync(directory);
  // The independent cancellation mechanism must exist before reserve-ack.
  writeFileSync(`${directory}/cgroup.kill`, '1');
  for (const [name, value] of Object.entries({
    'cpu.max': '100000 100000',
    'memory.max': String(memory),
    'memory.swap.max': '0',
    'memory.oom.group': '1',
    'pids.max': String(pids),
  })) {
    writeFileSync(`${directory}/${name}`, value);
    if (readFileSync(`${directory}/${name}`, 'utf8').trim() !== value)
      throw new Error('cgroup limit mismatch');
  }
}
export function noMounts(directory) {
  return !readFileSync('/proc/self/mountinfo', 'utf8')
    .split('\n')
    .some((line) => line.includes(directory));
}
