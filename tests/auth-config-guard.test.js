import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfigError } from '../server/auth/auth.js';

/**
 * Security hardening 3b: a missing AUTH_SECRET makes auth fall back to
 * anonymous admin. authConfigError() must flag that as a startup-blocking
 * misconfiguration UNLESS auth is explicitly disabled or sandbox/demo mode.
 */

function withEnv(env, fn) {
  const keys = ['AUTH_SECRET', 'AUTH_ENABLED', 'SANDBOX_MODE', 'DEMO_MODE'];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('missing secret with no explicit disable → error (would fail open)', () => {
  withEnv({}, () => assert.equal(typeof authConfigError(), 'string'));
  withEnv({ AUTH_ENABLED: 'true' }, () =>
    assert.equal(typeof authConfigError(), 'string')
  );
});

test('secret present → ok', () => {
  withEnv({ AUTH_SECRET: 'x'.repeat(32) }, () =>
    assert.equal(authConfigError(), null)
  );
});

test('explicit AUTH_ENABLED=false → ok even without secret', () => {
  withEnv({ AUTH_ENABLED: 'false' }, () =>
    assert.equal(authConfigError(), null)
  );
});

test('sandbox/demo mode → ok even without secret', () => {
  withEnv({ SANDBOX_MODE: '1' }, () => assert.equal(authConfigError(), null));
  withEnv({ DEMO_MODE: 'true' }, () => assert.equal(authConfigError(), null));
});
