import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_MODES,
  DEFAULT_STORAGE_MODE,
  getStorageMode,
  isPostgresMode,
  storageModeError,
} from '../server/config/database.js';

/**
 * PostgreSQL is the only storage backend, and STORAGE_MODE has one canonical
 * spelling. `postgresql` used to be a silent alias for `postgres`; the `file`
 * backend was removed in 1.x and now stops the boot with the import
 * instructions. Any unknown value is a boot error too, so an operator never
 * gets a backend they did not ask for.
 */

function withMode(value, fn) {
  const saved = process.env.STORAGE_MODE;
  if (value === undefined) delete process.env.STORAGE_MODE;
  else process.env.STORAGE_MODE = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.STORAGE_MODE;
    else process.env.STORAGE_MODE = saved;
  }
}

test('unset STORAGE_MODE resolves to Postgres', () => {
  withMode(undefined, () => {
    assert.equal(getStorageMode(), 'postgres');
    assert.equal(getStorageMode(), DEFAULT_STORAGE_MODE);
    assert.equal(isPostgresMode(), true);
    assert.equal(storageModeError(), null);
  });
  withMode('', () => {
    assert.equal(getStorageMode(), 'postgres');
    assert.equal(storageModeError(), null);
  });
});

test('postgres is the only accepted value', () => {
  assert.deepEqual([...STORAGE_MODES], ['postgres']);
  withMode('postgres', () => {
    assert.equal(getStorageMode(), 'postgres');
    assert.equal(storageModeError(), null, 'postgres should be valid');
  });
});

test('file is rejected with the import instructions', () => {
  withMode('file', () => {
    const err = storageModeError();
    assert.ok(err, 'the removed file backend must not be accepted');
    assert.match(err, /removed/);
    assert.match(err, /db:import/);
    // getStorageMode still resolves to the default for unvalidated callers.
    assert.equal(getStorageMode(), 'postgres');
  });
});

test('postgresql is rejected, and the message names the canonical spelling', () => {
  withMode('postgresql', () => {
    const err = storageModeError();
    assert.ok(err, 'postgresql must not be accepted as an alias');
    assert.match(err, /"postgres"/);
  });
});

test('a typo is rejected rather than resolved to file storage', () => {
  for (const bad of ['Postgres', 'POSTGRES', 'psql', 'File']) {
    withMode(bad, () => {
      const err = storageModeError();
      assert.ok(err, `${bad} should be rejected`);
      assert.match(err, /postgres/);
    });
  }
});

test('an unvalidated caller falls back to the default, never to file storage', () => {
  // Scripts and tests skip the boot guard; a typo there must not silently open
  // an empty file organization next to a populated database.
  withMode('postgresqlx', () => {
    assert.equal(getStorageMode(), 'postgres');
  });
});

test('surrounding whitespace is trimmed, not treated as a typo', () => {
  withMode(' postgres ', () => {
    assert.equal(getStorageMode(), 'postgres');
    assert.equal(storageModeError(), null);
  });
});
