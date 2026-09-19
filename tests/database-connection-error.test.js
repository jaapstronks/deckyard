import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  databaseConnectionError,
  getDatabaseConfig,
  isDatabaseConnectionError,
} from '../server/config/database.js';

/**
 * PostgreSQL is the only storage backend, so an install that cannot reach one
 * is over before it starts. Both places that meet that — the boot guard in
 * server/server.js and the `db:migrate` CLI — used to print pg-pool's own
 * AggregateError, whose `message` is the empty string: thirty lines of driver
 * internals and no instruction. These pin the one sentence they now share.
 *
 * The classification matters as much as the wording: a migration that fails on
 * its own SQL is a Deckyard bug and must keep its stack trace, not be dressed
 * up as "cannot reach PostgreSQL".
 */

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** The discrete DATABASE_* vars a fresh install has: none. */
const FRESH = {
  DATABASE_URL: undefined,
  DATABASE_HOST: undefined,
  DATABASE_PORT: undefined,
  DATABASE_NAME: undefined,
  DATABASE_USER: undefined,
  DATABASE_PASSWORD: undefined,
};

test('a refused socket names the target, the cause and the way out', () => {
  withEnv(FRESH, () => {
    const err = new AggregateError([], '');
    err.code = 'ECONNREFUSED';
    const msg = databaseConnectionError(err);

    // The connection it actually tried — the default a fresh .env resolves to.
    assert.match(msg, /deckyard@localhost:5432\/deckyard/);
    assert.match(msg, /ECONNREFUSED/);
    // No fallback exists, and the message says so rather than implying one.
    assert.match(msg, /only storage backend/);
    // Both ways out, and the schema step that follows either.
    assert.match(msg, /docker run .*postgres:16/s);
    assert.match(msg, /npm run db:migrate/);
    assert.match(msg, /docker-compose\.local\.yml/);
  });
});

test('the password never appears in the message', () => {
  withEnv({ ...FRESH, DATABASE_PASSWORD: 'hunter2-should-not-leak' }, () => {
    const err = new Error('nope');
    err.code = 'ECONNREFUSED';
    assert.doesNotMatch(databaseConnectionError(err), /hunter2/);
  });
  withEnv(
    { ...FRESH, DATABASE_URL: 'postgres://u:hunter2-should-not-leak@h:5432/d' },
    () => {
      const err = new Error('nope');
      err.code = 'ECONNREFUSED';
      assert.doesNotMatch(databaseConnectionError(err), /hunter2/);
    },
  );
});

test('a reachable server with no such database says so, and how to make one', () => {
  withEnv(FRESH, () => {
    const err = new Error('database "deckyard" does not exist');
    err.code = '3D000';
    const msg = databaseConnectionError(err);

    assert.match(msg, /is reachable, but that database does not exist/);
    assert.match(msg, /createdb -h localhost -U deckyard deckyard/);
    // Not the "install PostgreSQL" advice: the server is already running.
    assert.doesNotMatch(msg, /docker run/);
  });
});

test('rejected credentials point at the two settings that carry them', () => {
  withEnv(FRESH, () => {
    const err = new Error('password authentication failed for user "deckyard"');
    err.code = '28P01';
    const msg = databaseConnectionError(err);

    assert.match(msg, /refused the credentials/);
    assert.match(msg, /DATABASE_USER and DATABASE_PASSWORD/);
    assert.doesNotMatch(msg, /docker run/);
  });
});

test('an unparseable DATABASE_URL answers with its own sentence, not a second throw', () => {
  withEnv({ ...FRESH, DATABASE_URL: 'not-a-url' }, () => {
    // The real error, thrown before any socket opens — not a hand-built stand-in.
    let thrown;
    try {
      getDatabaseConfig();
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, 'getDatabaseConfig() must reject an unparseable URL');
    assert.equal(isDatabaseConnectionError(thrown), true);
    // Naming a connection target would mean parsing the URL that cannot be
    // parsed; the message is the config error's own.
    assert.equal(databaseConnectionError(thrown), thrown.message);
  });
});

test("only connection-class errors are the operator's to fix", () => {
  for (const code of [
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    '08006',
    '28P01',
    '3D000',
    '57P03',
    'DECKYARD_DATABASE_URL_INVALID',
  ]) {
    assert.equal(isDatabaseConnectionError({ code }), true, code);
  }

  // A migration that collides with an existing table, a bug with no code at
  // all: these keep their stack trace instead of becoming install advice.
  for (const err of [
    { code: '42P07' }, // duplicate_table
    { code: '42601' }, // syntax_error
    new TypeError('x is not a function'),
    {},
    null,
  ]) {
    assert.equal(isDatabaseConnectionError(err), false);
  }
});

test('a server that wants a password when none is set says which setting to add', () => {
  withEnv(FRESH, () => {
    // pg raises this client-side, before a `code` exists — the realistic first
    // failure of a fresh install that does have a PostgreSQL running.
    const err = new Error(
      'SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string',
    );

    assert.equal(isDatabaseConnectionError(err), true);
    const msg = databaseConnectionError(err);
    assert.match(msg, /asked for a password, and none is configured/);
    assert.match(msg, /DATABASE_PASSWORD=/);
    assert.match(msg, /DATABASE_URL=postgres:\/\/user:password@/);
    // Not the "nothing is listening" advice: something answered.
    assert.doesNotMatch(msg, /docker run/);
  });
});
