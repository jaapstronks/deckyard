/**
 * Public API v1: a deck's theme and language have one name, `theme` and `lang`
 * (B446).
 *
 * The docs said `themeId`/`language`, create read `theme`/`lang`, every
 * response answered `themeId: null` and `language: en-GB`, and a PUT dropped
 * `theme` without a word. A client that followed the docs got a default-theme
 * deck in the wrong language. These tests pin the one shape: the canonical
 * names work on create, read and update, a theme switch through PUT takes
 * the same path as the editor's /change-theme, and the retired spellings are
 * refused with the name to use instead.
 *
 * Runs against the in-memory database double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/public-api-theme-lang.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handlePresentations } =
  await import('../server/routes/public-api/v1/presentations.js');

/** A fresh, empty database double behind the storage facade. */
async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

/**
 * Request context for the v1 presentations router, key already authenticated.
 * @param {string} method
 * @param {string} pathname
 * @param {Object|null} [body]
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
 */
function makeCtx(method, pathname, body = null) {
  const req = Readable.from(
    body === null ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: userIdFor(OWNER),
      actorEmail: OWNER,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: OWNER,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: {
      id: userIdFor(OWNER),
      email: OWNER,
      role: 'user',
      organizationId: ORG,
    },
  };
}

/** Run one request through the router and return the recorded response. */
async function call(method, pathname, body = null) {
  const ctx = makeCtx(method, pathname, body);
  await handlePresentations(ctx);
  return ctx.res;
}

/** Create a deck and return the response presentation. */
async function create(body) {
  const res = await call('POST', '/api/v1/presentations', body);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.presentation;
}

/** The stored row of a deck, straight from the double. */
function storedDeck(db, id) {
  return db.__tables.presentations.find((row) => row.id === id);
}

test('create with theme + lang stores both and answers them', async () => {
  const db = await installDb();
  const pres = await create({
    title: 'Q1',
    theme: 'midnight',
    lang: 'en-GB',
  });

  const row = storedDeck(db, pres.id);
  assert.equal(row.theme, 'midnight');
  assert.equal(row.lang, 'en-GB');
  assert.equal(row.i18n.dominant, 'en-GB');

  assert.equal(pres.theme, 'midnight');
  assert.equal(pres.lang, 'en-GB');
  assert.ok(!('themeId' in pres), 'the retired name is not published');
  assert.ok(!('language' in pres), 'the retired name is not published');
});

test('GET answers the real theme and language, per deck', async () => {
  await installDb();
  const en = await create({ title: 'EN', theme: 'midnight', lang: 'en-GB' });
  const nl = await create({ title: 'NL', theme: 'amethyst', lang: 'nl' });

  const gotEn = await call('GET', `/api/v1/presentations/${en.id}`);
  assert.equal(gotEn.statusCode, 200);
  assert.equal(gotEn.body.presentation.theme, 'midnight');
  assert.equal(gotEn.body.presentation.lang, 'en-GB');

  const gotNl = await call('GET', `/api/v1/presentations/${nl.id}`);
  assert.equal(gotNl.body.presentation.theme, 'amethyst');
  assert.equal(gotNl.body.presentation.lang, 'nl');

  const list = await call('GET', '/api/v1/presentations');
  const byId = new Map(list.body.presentations.map((p) => [p.id, p]));
  assert.equal(byId.get(en.id).lang, 'en-GB');
  assert.equal(byId.get(nl.id).theme, 'amethyst');
});

test('PUT with another theme switches it; the slides stay', async () => {
  const db = await installDb();
  const pres = await create({ title: 'Switch', theme: 'midnight', lang: 'nl' });
  const slidesBefore = storedDeck(db, pres.id).slides;

  const res = await call('PUT', `/api/v1/presentations/${pres.id}`, {
    theme: 'amethyst',
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.presentation.theme, 'amethyst');

  const row = storedDeck(db, pres.id);
  assert.equal(row.theme, 'amethyst');
  assert.deepEqual(
    row.slides,
    slidesBefore,
    'a body without slides keeps them',
  );
});

test('a GET echoed back through PUT is a plain save', async () => {
  const db = await installDb();
  const pres = await create({ title: 'Echo', theme: 'midnight', lang: 'nl' });
  const got = await call('GET', `/api/v1/presentations/${pres.id}`);

  const { title, theme, lang } = got.body.presentation;
  const res = await call('PUT', `/api/v1/presentations/${pres.id}`, {
    title: `${title}!`,
    theme,
    lang,
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = storedDeck(db, pres.id);
  assert.equal(row.title, 'Echo!');
  assert.equal(row.theme, 'midnight');
  assert.equal(row.lang, 'nl');
});

test('the retired spellings are refused with the name to use', async () => {
  const db = await installDb();
  for (const [field, use] of [
    ['themeId', 'theme'],
    ['language', 'lang'],
  ]) {
    const res = await call('POST', '/api/v1/presentations', {
      title: 'Retired',
      [field]: field === 'language' ? 'en-GB' : 'midnight',
    });
    assert.equal(res.statusCode, 400, `${field} on create`);
    assert.equal(res.body.details.field, field);
    assert.equal(res.body.details.use, use);
    assert.match(res.body.message, new RegExp(`"${use}"`));
  }
  assert.equal(
    (db.__tables.presentations || []).length,
    0,
    'nothing was created',
  );

  const pres = await create({ title: 'Deck', theme: 'midnight' });
  const res = await call('PUT', `/api/v1/presentations/${pres.id}`, {
    themeId: 'amethyst',
  });
  assert.equal(res.statusCode, 400, 'themeId on update');
  assert.equal(res.body.details.use, 'theme');
  assert.equal(storedDeck(db, pres.id).theme, 'midnight');
});

test('an unknown theme or unsupported lang is refused, not defaulted', async () => {
  const db = await installDb();
  const badTheme = await call('POST', '/api/v1/presentations', {
    title: 'X',
    theme: 'no-such-theme',
  });
  assert.equal(badTheme.statusCode, 400);
  assert.equal(badTheme.body.details.field, 'theme');

  const badLang = await call('POST', '/api/v1/presentations', {
    title: 'X',
    lang: 'xx',
  });
  assert.equal(badLang.statusCode, 400);
  assert.equal(badLang.body.details.field, 'lang');
  assert.equal((db.__tables.presentations || []).length, 0);

  const pres = await create({ title: 'Deck', theme: 'midnight', lang: 'nl' });
  const switchBad = await call('PUT', `/api/v1/presentations/${pres.id}`, {
    theme: 'no-such-theme',
  });
  assert.equal(switchBad.statusCode, 400);
  assert.equal(switchBad.body.details.field, 'theme');
  assert.equal(storedDeck(db, pres.id).theme, 'midnight');

  const langChange = await call('PUT', `/api/v1/presentations/${pres.id}`, {
    lang: 'en-GB',
  });
  assert.equal(langChange.statusCode, 400);
  assert.equal(langChange.body.details.field, 'lang');
  assert.equal(storedDeck(db, pres.id).lang, 'nl');
});
