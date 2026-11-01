import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { authConfigError, authEnabled } from '../server/auth/auth.js';

/**
 * Security hardening 3b: a missing AUTH_SECRET makes auth fall back to
 * anonymous admin. authConfigError() must flag that as a startup-blocking
 * misconfiguration UNLESS auth is explicitly disabled or demo mode. Sandbox mode
 * has no exemption: AUTH_SECRET signs its guest cookies (B501).
 */

function withEnv(env, fn) {
  const keys = [
    'AUTH_SECRET',
    'AUTH_ENABLED',
    'SANDBOX_MODE',
    'DEMO_MODE',
    'COLLAB_ENABLED',
    'AUTH_ALLOW_WEAK_SECRET',
  ];
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
    assert.equal(typeof authConfigError(), 'string'),
  );
});

test('secret present → ok', () => {
  withEnv({ AUTH_SECRET: 'x'.repeat(32) }, () =>
    assert.equal(authConfigError(), null),
  );
});

test('explicit AUTH_ENABLED=false → ok even without secret', () => {
  withEnv({ AUTH_ENABLED: 'false' }, () =>
    assert.equal(authConfigError(), null),
  );
});

test('demo mode → ok even without secret', () => {
  withEnv({ DEMO_MODE: 'true' }, () => assert.equal(authConfigError(), null));
});

test('sandbox mode → fatal without a strong secret, whatever else is set', () => {
  const strong = 'x'.repeat(32);
  for (const env of [
    { SANDBOX_MODE: '1' },
    { SANDBOX_MODE: '1', AUTH_ENABLED: 'false' },
    { SANDBOX_MODE: '1', AUTH_SECRET: 'x'.repeat(31) },
    { SANDBOX_MODE: '1', AUTH_SECRET: 'short', DEMO_MODE: 'true' },
  ]) {
    withEnv(env, () =>
      assert.match(String(authConfigError()), /SANDBOX_MODE needs/),
    );
  }
  withEnv({ SANDBOX_MODE: '1', AUTH_SECRET: strong }, () =>
    assert.equal(authConfigError(), null),
  );
});

/**
 * AUTH_ENABLED contract (default-ON security flag; see .env.example):
 * unset/blank → enabled; explicit falsy token (false/0/no/off) → disabled;
 * anything unrecognized → enabled. A typo must never silently disable auth
 * (that would fail open to anonymous admin), so unlike a default-off flag the
 * only path to "off" is a recognized falsy token.
 */
const SECRET = { AUTH_SECRET: 'x'.repeat(32) };

test('sandbox + collab is fatal regardless of auth/demo escape hatches', () => {
  for (const extra of [
    {},
    { AUTH_ENABLED: 'false' },
    { DEMO_MODE: 'true' },
    { AUTH_ALLOW_WEAK_SECRET: 'true' },
  ]) {
    withEnv(
      { ...SECRET, SANDBOX_MODE: '1', COLLAB_ENABLED: 'true', ...extra },
      () => assert.match(authConfigError(), /SANDBOX_MODE cannot be combined/),
    );
  }
  withEnv({ ...SECRET, COLLAB_ENABLED: 'true' }, () =>
    assert.equal(authConfigError(), null),
  );
  for (const value of ['false', '0', 'no', 'off']) {
    withEnv({ ...SECRET, SANDBOX_MODE: '1', COLLAB_ENABLED: value }, () =>
      assert.equal(authConfigError(), null),
    );
  }
});

test('sandbox + collab exits before storage or a listener starts', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../server/server.js', import.meta.url))],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        AUTH_DEV_BYPASS: 'false',
        SANDBOX_MODE: '1',
        COLLAB_ENABLED: 'true',
        AUTH_ENABLED: 'true',
        AUTH_SECRET: 'sandbox-boot-regression-secret-at-least-32',
        DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
        DATABASE_HOST: '127.0.0.1',
        DATABASE_PORT: '1',
        DATABASE_NAME: 'unused',
        DATABASE_USER: 'unused',
        DATABASE_PASSWORD: 'unused',
      },
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /SANDBOX_MODE cannot be combined with COLLAB_ENABLED/,
  );
  assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
});

test('authEnabled: unset or blank AUTH_ENABLED → enabled', () => {
  withEnv({ ...SECRET }, () => assert.equal(authEnabled(), true));
  withEnv({ ...SECRET, AUTH_ENABLED: '' }, () =>
    assert.equal(authEnabled(), true),
  );
});

test('authEnabled: explicit falsy token → disabled', () => {
  for (const v of ['false', 'FALSE', '0', 'no', 'off']) {
    withEnv({ ...SECRET, AUTH_ENABLED: v }, () =>
      assert.equal(authEnabled(), false, `AUTH_ENABLED=${v}`),
    );
  }
});

test('authEnabled: truthy or unrecognized value → enabled (fail-closed)', () => {
  for (const v of ['true', '1', 'yes', 'on', 'banana', 'fasle']) {
    withEnv({ ...SECRET, AUTH_ENABLED: v }, () =>
      assert.equal(authEnabled(), true, `AUTH_ENABLED=${v}`),
    );
  }
});

test('authEnabled: no secret → disabled regardless of AUTH_ENABLED', () => {
  withEnv({ AUTH_ENABLED: 'true' }, () => assert.equal(authEnabled(), false));
});

test('authConfigError: every falsy token counts as an explicit disable', () => {
  for (const v of ['false', '0', 'no', 'off']) {
    withEnv({ AUTH_ENABLED: v }, () =>
      assert.equal(authConfigError(), null, `AUTH_ENABLED=${v}`),
    );
  }
  // An unrecognized value is NOT an explicit disable: without a secret that
  // must still block boot.
  withEnv({ AUTH_ENABLED: 'banana' }, () =>
    assert.equal(typeof authConfigError(), 'string'),
  );
});
