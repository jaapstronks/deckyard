/**
 * `shutDownBrowser()` leaves nothing behind that keeps the process alive
 * (B549).
 *
 * On macOS with Google Chrome, `browser.close()` resolved while four
 * `PipeWrap` handles stayed open, so a test process that rendered anything
 * never ended. The cause is general: puppeteer resolves the close on the
 * Chrome process's `exit`, but its stdio pipes stay open as long as a helper
 * that inherited them lives on. These tests model that without a browser - a
 * real child process whose own child outlives it - plus a close that never
 * resolves. The real-Chrome half is the handle check at the end of
 * `export-chrome-smoke.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { shutDownBrowser } from '../server/utils/puppeteer-browser.js';

const isWindows = process.platform === 'win32';

/**
 * Spawn a process the way puppeteer spawns Chrome: detached, three pipes.
 *
 * @param {string} script shell script to run
 */
function spawnLikeChrome(script) {
  return spawn('/bin/sh', ['-c', script], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Kill what is left of the process group, the outliving helper included. */
function killGroup(proc) {
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/**
 * The scenario as a standalone Node process: spawn a "browser" whose helper
 * outlives it holding stdout/stderr, shut it down, and do nothing else. The
 * process must then end on its own - no `process.exit`.
 */
const LINGERING_HELPER_SCRIPT = `
  import { spawn } from 'node:child_process';
  import { once } from 'node:events';
  import { shutDownBrowser } from ${JSON.stringify(
    new URL('../server/utils/puppeteer-browser.js', import.meta.url).href,
  )};
  const proc = spawn('/bin/sh', ['-c', 'sleep 30 & exit 0'], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  process.stdout.write(String(proc.pid));
  const exited = once(proc, 'exit');
  await shutDownBrowser({ process: () => proc, close: () => exited });
`;

test(
  'a helper that inherited stdio and outlives the browser does not keep the process alive',
  { skip: isWindows && 'POSIX process groups' },
  async () => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', LINGERING_HELPER_SCRIPT],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let groupPid = '';
    child.stdout.on('data', (chunk) => (groupPid += chunk));
    const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    const started = Date.now();
    try {
      const [code, signal] = await once(child, 'exit');
      assert.equal(signal, null, 'the process ended by itself, not killed');
      assert.equal(code, 0);
      assert.ok(Date.now() - started < 10_000);
    } finally {
      clearTimeout(killer);
      if (groupPid) killGroup({ pid: Number(groupPid) });
    }
  },
);

test(
  'every stdio stream of the browser process is closed once shutdown resolves',
  { skip: isWindows && 'POSIX process groups' },
  async () => {
    const proc = spawnLikeChrome('sleep 30 & exit 0');
    try {
      const exited = once(proc, 'exit');
      await shutDownBrowser({ process: () => proc, close: () => exited });

      assert.ok(proc.stdio.every((stream) => stream.closed));
    } finally {
      killGroup(proc);
    }
  },
);

test(
  'a close that never resolves is cut off: the process is killed within the timeout',
  { skip: isWindows && 'POSIX signals' },
  async () => {
    const proc = spawnLikeChrome('exec sleep 30');
    try {
      const exited = once(proc, 'exit');
      const browser = {
        process: () => proc,
        close: () => new Promise(() => {}),
      };

      const started = Date.now();
      await shutDownBrowser(browser, { timeoutMs: 100 });
      const [, signal] = await exited;

      assert.ok(Date.now() - started < 2000, 'shutdown did not wait on close');
      assert.equal(signal, 'SIGKILL');
    } finally {
      killGroup(proc);
    }
  },
);

test('a close that rejects still releases the stdio streams', async () => {
  const proc = spawnLikeChrome('exec sleep 30');
  try {
    const browser = {
      process: () => proc,
      close: async () => {
        proc.kill('SIGKILL');
        throw new Error('Target closed');
      },
    };

    await shutDownBrowser(browser);

    assert.ok(proc.stdio.every((stream) => !stream || stream.destroyed));
  } finally {
    killGroup(proc);
  }
});
