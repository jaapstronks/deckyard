import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabaseConfig } from '../server/config/database.js';

/**
 * `DATABASE_URL`, when set, is the complete connection override: it wins over
 * the discrete `DATABASE_*` variables so that `db:migrate` (and the app pool,
 * and the data importer — they share {@link getDatabaseConfig}) migrate the
 * database the URL names, not the `.env` dev database.
 *
 * The concrete hazard this pins: the `test:pg` recipe expresses its throwaway
 * database as `DATABASE_URL`. Before this, a bare `npm run db:migrate` read only
 * `DATABASE_HOST`/`DATABASE_NAME` and migrated the dev database instead (it bit
 * at #626, where the migration happened to be idempotent).
 */

const DB_ENV = [
  'DATABASE_URL',
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_SSL',
  'DATABASE_SSL_REJECT_UNAUTHORIZED',
];

/** Run `fn` with the given DB-related env, restoring the prior values after. */
function withEnv(env, fn) {
  const saved = {};
  for (const key of DB_ENV) saved[key] = process.env[key];
  for (const key of DB_ENV) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  try {
    return fn();
  } finally {
    for (const key of DB_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('DATABASE_URL wins over the discrete DATABASE_* vars', () => {
  withEnv(
    {
      DATABASE_URL:
        'postgres://scratch_user:scratch_pw@db.example:6543/deckyard_pg_tests',
      // The dev config that must be ignored when DATABASE_URL is set.
      DATABASE_HOST: 'localhost',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'deckyard_dev',
      DATABASE_USER: 'deckyard',
      DATABASE_PASSWORD: 'devpw',
    },
    () => {
      const config = getDatabaseConfig();
      assert.equal(config.host, 'db.example');
      assert.equal(config.port, 6543);
      assert.equal(config.database, 'deckyard_pg_tests');
      assert.equal(config.user, 'scratch_user');
      assert.equal(config.password, 'scratch_pw');
    },
  );
});

test('DATABASE_URL is a complete override, not a merge with DATABASE_*', () => {
  // A URL with no port/credentials must not fall back to DATABASE_PORT etc.
  withEnv(
    {
      DATABASE_URL: 'postgres://localhost/deckyard_pg_tests',
      DATABASE_PORT: '9999',
      DATABASE_USER: 'devuser',
      DATABASE_PASSWORD: 'devpw',
    },
    () => {
      const config = getDatabaseConfig();
      assert.equal(config.host, 'localhost');
      assert.equal(
        config.port,
        5432,
        'missing URL port defaults to 5432, not DATABASE_PORT',
      );
      assert.equal(config.database, 'deckyard_pg_tests');
      assert.equal(
        config.user,
        'deckyard',
        'missing URL user is the default, not DATABASE_USER',
      );
      assert.equal(
        config.password,
        '',
        'missing URL password is empty, not DATABASE_PASSWORD',
      );
    },
  );
});

test('an empty DATABASE_URL is ignored, falling back to DATABASE_*', () => {
  withEnv(
    {
      DATABASE_URL: '   ',
      DATABASE_HOST: 'dev.example',
      DATABASE_NAME: 'deckyard_dev',
    },
    () => {
      const config = getDatabaseConfig();
      assert.equal(config.host, 'dev.example');
      assert.equal(config.database, 'deckyard_dev');
    },
  );
});

test('with no DATABASE_URL the discrete DATABASE_* vars are used', () => {
  withEnv(
    {
      DATABASE_HOST: 'dev.example',
      DATABASE_PORT: '5544',
      DATABASE_NAME: 'deckyard_dev',
      DATABASE_USER: 'devuser',
      DATABASE_PASSWORD: 'devpw',
    },
    () => {
      const config = getDatabaseConfig();
      assert.equal(config.host, 'dev.example');
      assert.equal(config.port, 5544);
      assert.equal(config.database, 'deckyard_dev');
      assert.equal(config.user, 'devuser');
      assert.equal(config.password, 'devpw');
    },
  );
});

test('SSL derives from the DATABASE_URL host, and DATABASE_SSL still applies on top', () => {
  // Non-localhost host from the URL turns SSL on by default.
  withEnv({ DATABASE_URL: 'postgres://u:p@managed.db:5432/deckyard' }, () => {
    assert.deepEqual(getDatabaseConfig().ssl, { rejectUnauthorized: true });
  });
  // localhost host from the URL leaves SSL off.
  withEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/deckyard' }, () => {
    assert.equal(getDatabaseConfig().ssl, false);
  });
  // DATABASE_SSL=false forces it off even for a remote host.
  withEnv(
    {
      DATABASE_URL: 'postgres://u:p@managed.db:5432/deckyard',
      DATABASE_SSL: 'false',
    },
    () => {
      assert.equal(getDatabaseConfig().ssl, false);
    },
  );
});

test('percent-encoded credentials in DATABASE_URL are decoded', () => {
  withEnv(
    { DATABASE_URL: 'postgres://user%40corp:p%40ss%3Aword@host:5432/deckyard' },
    () => {
      const config = getDatabaseConfig();
      assert.equal(config.user, 'user@corp');
      assert.equal(config.password, 'p@ss:word');
    },
  );
});

test('a malformed DATABASE_URL fails loud instead of silently using DATABASE_*', () => {
  withEnv({ DATABASE_URL: 'not-a-url', DATABASE_HOST: 'localhost' }, () => {
    assert.throws(() => getDatabaseConfig(), /DATABASE_URL/);
  });
});
