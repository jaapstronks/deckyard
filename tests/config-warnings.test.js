import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfigWarnings } from '../server/auth/auth.js';
import { publicUrlWarnings } from '../server/config/utils.js';

/**
 * Security follow-up: non-fatal startup warnings. Unlike authConfigError(),
 * these never block boot — they only nudge the operator to tighten a weak but
 * functional configuration (short secret, no public URL).
 */

function withEnv(env, fn) {
  const keys = ['AUTH_SECRET', 'AUTH_ENABLED', 'APP_URL', 'DOMAIN'];
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

test('short AUTH_SECRET → warning', () => {
  withEnv({ AUTH_SECRET: 'tooshort' }, () =>
    assert.equal(authConfigWarnings().length, 1)
  );
});

test('32+ char AUTH_SECRET → no warning', () => {
  withEnv({ AUTH_SECRET: 'x'.repeat(32) }, () =>
    assert.deepEqual(authConfigWarnings(), [])
  );
});

test('short secret but auth explicitly disabled → no warning', () => {
  withEnv({ AUTH_SECRET: 'tooshort', AUTH_ENABLED: 'false' }, () =>
    assert.deepEqual(authConfigWarnings(), [])
  );
});

test('missing secret → no short-secret warning (that is authConfigError territory)', () => {
  withEnv({}, () => assert.deepEqual(authConfigWarnings(), []));
});

test('no APP_URL and no DOMAIN → warning', () => {
  withEnv({}, () => assert.equal(publicUrlWarnings().length, 1));
});

test('APP_URL set → no warning', () => {
  withEnv({ APP_URL: 'https://slides.example.com' }, () =>
    assert.deepEqual(publicUrlWarnings(), [])
  );
});

test('DOMAIN set → no warning', () => {
  withEnv({ DOMAIN: 'slides.example.com' }, () =>
    assert.deepEqual(publicUrlWarnings(), [])
  );
});
