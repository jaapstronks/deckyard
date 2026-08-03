import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiWorkspaceStorageError } from '../server/config/features.js';

/**
 * Tenant-isolation boot guard: MULTI_WORKSPACE_ENABLED serves multiple
 * organizations from one instance, so deck isolation must come from the
 * storage layer. The guard failed closed on the file backend, which had no
 * org dimension; that backend was removed in 1.x, so every mode now resolves
 * to Postgres and the guard can no longer fire. It is inert and slated for
 * removal with the rest of the one-backend cleanup; until then this pins
 * that it never blocks a supported boot.
 *
 * The function reads process.env at call time, so we toggle env per case.
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

test('no error when multi-workspace is disabled (single-org)', () => {
  withEnv({ MULTI_WORKSPACE_ENABLED: undefined, STORAGE_MODE: undefined }, () => {
    assert.equal(multiWorkspaceStorageError(), null);
  });
});

test('no error: multi-workspace on Postgres, including the default (unset) mode', () => {
  // A removed backend cannot be selected, so even a stale STORAGE_MODE=file in
  // the environment resolves to Postgres here (the boot stops on it earlier,
  // in storageModeError()).
  for (const mode of ['postgres', undefined, 'file']) {
    withEnv({ MULTI_WORKSPACE_ENABLED: 'true', STORAGE_MODE: mode, SANDBOX_MODE: undefined }, () => {
      assert.equal(multiWorkspaceStorageError(), null, `mode=${mode}`);
    });
  }
});

test('sandbox is exempt: single-org anonymous instance never triggers the guard', () => {
  withEnv({ MULTI_WORKSPACE_ENABLED: 'true', SANDBOX_MODE: 'true' }, () => {
    assert.equal(multiWorkspaceStorageError(), null);
  });
});
