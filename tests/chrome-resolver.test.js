/**
 * The Chrome resolver skips Ubuntu's `chromium-browser` snap stub (B499).
 *
 * On Ubuntu that name is a transitional shell script that is executable but
 * only asks for `snap install chromium`. Found before an installed Google
 * Chrome, it made every export and capture fail at launch on dev-server-1.
 * These tests pin the preference order through the resolver's test seam, so
 * they do not depend on which browsers the machine running them has.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHROME_CANDIDATE_PATHS,
  resolveChromeExecutablePath,
} from '../server/utils/puppeteer-browser.js';

/** Run `fn` with the browser env overrides unset, restoring them after. */
async function withoutEnvOverride(fn) {
  const saved = {
    PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
    CHROME_BIN: process.env.CHROME_BIN,
  };
  delete process.env.PUPPETEER_EXECUTABLE_PATH;
  delete process.env.CHROME_BIN;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** @param {string[]} present */
const only = (present) => async (path) => present.includes(path);

test('Google Chrome wins over the chromium-browser snap stub', async () => {
  const path = await withoutEnvOverride(() =>
    resolveChromeExecutablePath({
      isExecutable: only(['/usr/bin/chromium-browser', '/usr/bin/google-chrome']),
    }),
  );
  assert.equal(path, '/usr/bin/google-chrome');
});

test('chromium wins over chromium-browser where both exist', async () => {
  const path = await withoutEnvOverride(() =>
    resolveChromeExecutablePath({
      isExecutable: only(['/usr/bin/chromium-browser', '/usr/bin/chromium']),
    }),
  );
  assert.equal(path, '/usr/bin/chromium');
});

test('chromium-browser is still found when it is the only browser', async () => {
  const path = await withoutEnvOverride(() =>
    resolveChromeExecutablePath({
      isExecutable: only(['/usr/bin/chromium-browser']),
    }),
  );
  assert.equal(path, '/usr/bin/chromium-browser');
});

test('the env override wins over every well-known location', async () => {
  const saved = process.env.PUPPETEER_EXECUTABLE_PATH;
  process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/pinned/chrome';
  try {
    const path = await resolveChromeExecutablePath({
      isExecutable: only(['/opt/pinned/chrome', ...CHROME_CANDIDATE_PATHS]),
    });
    assert.equal(path, '/opt/pinned/chrome');
  } finally {
    if (saved === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
    else process.env.PUPPETEER_EXECUTABLE_PATH = saved;
  }
});

test('nothing executable resolves to an empty string', async () => {
  const path = await withoutEnvOverride(() =>
    resolveChromeExecutablePath({ isExecutable: only([]) }),
  );
  assert.equal(path, '');
});
