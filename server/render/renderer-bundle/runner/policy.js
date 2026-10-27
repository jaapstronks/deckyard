// Shared by the fixed OCI producer and trusted image bootstrap. No host paths,
// imports, environment reads or caller-controlled policy enter this module.
export const PROC_MASKS = Object.freeze([
  '/proc/acpi',
  '/proc/asound',
  '/proc/kcore',
  '/proc/keys',
  '/proc/latency_stats',
  '/proc/timer_list',
  '/proc/timer_stats',
  '/proc/sched_debug',
  '/proc/scsi',
  '/proc/interrupts',
  '/proc/sysrq-trigger',
  '/proc/sys',
]);
export const MOUNT_FLAGS = Object.freeze({
  '/bundle': ['rbind', 'ro', 'nosuid', 'nodev', 'rro'],
  '/dev': ['nosuid', 'noexec', 'mode=755', 'size=64k'],
  '/proc': ['ro', 'nosuid', 'nodev', 'noexec'],
  '/tmp': ['nosuid', 'nodev', 'noexec', 'size=64m', 'mode=1777'],
});

export const SELF_TEST_RESULT = 'deckyard.renderer-runner.self-test/1';
