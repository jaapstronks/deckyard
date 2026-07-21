import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devAuthBypassEnabled } from '../server/auth/auth.js';

/**
 * Security hardening 3a: the passwordless AUTH_DEV_BYPASS admin shortcut must
 * only be honored when NODE_ENV is explicitly 'development'. Any other value
 * (unset, 'staging', 'production', 'prod') must refuse it even when the flag
 * is set, so a leftover flag can't silently grant anonymous admin.
 */

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('bypass honored when NODE_ENV=development and flag set', () => {
  withEnv({ NODE_ENV: 'development', AUTH_DEV_BYPASS: 'true' }, () => {
    assert.equal(devAuthBypassEnabled(), true);
  });
  for (const v of ['1', 'yes', 'TRUE']) {
    withEnv({ NODE_ENV: 'development', AUTH_DEV_BYPASS: v }, () => {
      assert.equal(devAuthBypassEnabled(), true, `flag=${v}`);
    });
  }
});

test('bypass refused when flag set but NODE_ENV is not development', () => {
  for (const env of [undefined, '', 'production', 'prod', 'staging', 'test']) {
    withEnv({ NODE_ENV: env, AUTH_DEV_BYPASS: 'true' }, () => {
      assert.equal(
        devAuthBypassEnabled(),
        false,
        `NODE_ENV=${JSON.stringify(env)} must refuse bypass`
      );
    });
  }
});

test('bypass off when flag unset even in development', () => {
  withEnv({ NODE_ENV: 'development', AUTH_DEV_BYPASS: undefined }, () => {
    assert.equal(devAuthBypassEnabled(), false);
  });
  withEnv({ NODE_ENV: 'development', AUTH_DEV_BYPASS: 'false' }, () => {
    assert.equal(devAuthBypassEnabled(), false);
  });
});
