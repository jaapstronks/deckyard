import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfigError, authEnabled } from '../server/auth/auth.js';

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

/**
 * AUTH_ENABLED contract (default-ON security flag; see .env.example):
 * unset/blank → enabled; explicit falsy token (false/0/no/off) → disabled;
 * anything unrecognized → enabled. A typo must never silently disable auth
 * (that would fail open to anonymous admin), so unlike a default-off flag the
 * only path to "off" is a recognized falsy token.
 */
const SECRET = { AUTH_SECRET: 'x'.repeat(32) };

test('authEnabled: unset or blank AUTH_ENABLED → enabled', () => {
  withEnv({ ...SECRET }, () => assert.equal(authEnabled(), true));
  withEnv({ ...SECRET, AUTH_ENABLED: '' }, () =>
    assert.equal(authEnabled(), true)
  );
});

test('authEnabled: explicit falsy token → disabled', () => {
  for (const v of ['false', 'FALSE', '0', 'no', 'off']) {
    withEnv({ ...SECRET, AUTH_ENABLED: v }, () =>
      assert.equal(authEnabled(), false, `AUTH_ENABLED=${v}`)
    );
  }
});

test('authEnabled: truthy or unrecognized value → enabled (fail-closed)', () => {
  for (const v of ['true', '1', 'yes', 'on', 'banana', 'fasle']) {
    withEnv({ ...SECRET, AUTH_ENABLED: v }, () =>
      assert.equal(authEnabled(), true, `AUTH_ENABLED=${v}`)
    );
  }
});

test('authEnabled: no secret → disabled regardless of AUTH_ENABLED', () => {
  withEnv({ AUTH_ENABLED: 'true' }, () => assert.equal(authEnabled(), false));
});

test('authConfigError: every falsy token counts as an explicit disable', () => {
  for (const v of ['false', '0', 'no', 'off']) {
    withEnv({ AUTH_ENABLED: v }, () =>
      assert.equal(authConfigError(), null, `AUTH_ENABLED=${v}`)
    );
  }
  // An unrecognized value is NOT an explicit disable: without a secret that
  // must still block boot.
  withEnv({ AUTH_ENABLED: 'banana' }, () =>
    assert.equal(typeof authConfigError(), 'string')
  );
});
