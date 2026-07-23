import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiWorkspaceStorageError } from '../server/config/features.js';

/**
 * Tenant-isolation boot guard: MULTI_WORKSPACE_ENABLED serves multiple
 * organizations from one instance, so deck isolation must come from the
 * storage layer. The Postgres backend scopes every query by organization_id;
 * the file backend has no org dimension and would leak workspace decks across
 * tenants. The guard must fail closed (return an error string) on the file
 * backend and pass (null) on Postgres. Sandbox is single-org and exempt.
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

test('no error when multi-workspace is disabled (single-org, any backend)', () => {
  withEnv({ MULTI_WORKSPACE_ENABLED: undefined, STORAGE_MODE: undefined }, () => {
    assert.equal(multiWorkspaceStorageError(), null);
  });
  withEnv({ MULTI_WORKSPACE_ENABLED: 'false', STORAGE_MODE: 'file' }, () => {
    assert.equal(multiWorkspaceStorageError(), null);
  });
});

test('fails closed: multi-workspace on the file backend returns an error', () => {
  for (const flag of ['1', 'true', 'yes', 'on']) {
    withEnv({ MULTI_WORKSPACE_ENABLED: flag, STORAGE_MODE: 'file', SANDBOX_MODE: undefined }, () => {
      const err = multiWorkspaceStorageError();
      assert.ok(err, `expected an error for flag=${flag}`);
      assert.match(err, /Postgres/, 'error should point at the Postgres requirement');
    });
  }
  // Default STORAGE_MODE (unset) resolves to file — same footgun.
  withEnv({ MULTI_WORKSPACE_ENABLED: 'true', STORAGE_MODE: undefined, SANDBOX_MODE: undefined }, () => {
    assert.ok(multiWorkspaceStorageError());
  });
});

test('no error: multi-workspace on Postgres (org-scoped storage)', () => {
  for (const mode of ['postgres', 'postgresql', 'Postgres']) {
    withEnv({ MULTI_WORKSPACE_ENABLED: 'true', STORAGE_MODE: mode, SANDBOX_MODE: undefined }, () => {
      assert.equal(multiWorkspaceStorageError(), null, `mode=${mode}`);
    });
  }
});

test('sandbox is exempt: single-org anonymous instance never triggers the guard', () => {
  withEnv({ MULTI_WORKSPACE_ENABLED: 'true', STORAGE_MODE: 'file', SANDBOX_MODE: 'true' }, () => {
    assert.equal(multiWorkspaceStorageError(), null);
  });
});
