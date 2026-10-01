/**
 * B576: the internal create routes refuse an unsupported `lang` before the work.
 *
 * Since B521 the v1 wizard and the MCP create tools refuse an unsupported
 * `lang` with 400 `invalid`, `details.field: 'lang'` (D291). The internal AI
 * wizard (`/api/ai/wizard`, `/api/ai/wizard-v2/stream`), the file conversion
 * (`/api/convert`, `/api/convert/stream`) and the Notion import
 * (`/api/notion/import`, `/api/notion/import/stream`) read `lang` with
 * `getLang`/`getLangOrAuto`, which let an unknown tag fall back to the default
 * language without a word: one meaning, two answers. Each now runs
 * `assertCreatableDeckInput(body)` first, so the refusal is the same on every
 * contract and costs no LLM call and no conversion. "Detect the language" is
 * an absent `lang` there too; `'auto'` is not a deck language on the wire.
 *
 * "Before the work" is shown by what the request reaches: every body below
 * also names a theme this instance does not have, and no database and no AI
 * vendor is installed. The theme lookup runs before any generation or
 * conversion, so a `lang` refusal (not a theme refusal, not a storage or
 * vendor failure) means the request stopped ahead of all of it.
 *
 * Run with: node --test tests/internal-create-lang-refusal.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { handleAi } = await import('../server/routes/api/ai/index.js');
const { handleConvert } = await import('../server/routes/api/convert.js');
const { handleNotion } = await import('../server/routes/api/notion/index.js');

/** A response double capturing the status/body the http helpers write. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
      this.headersSent = true;
      return this;
    },
    write() {
      return true;
    },
    end(payload) {
      this.writableEnded = true;
      try {
        this.body = payload ? JSON.parse(payload) : null;
      } catch {
        this.body = null;
      }
      return this;
    },
  };
}

/** POST `body` through a module's dispatcher, as the API router does. */
async function post(dispatch, pathname, body) {
  const payload = JSON.stringify(body);
  const res = makeRes();
  await dispatch({
    repoRoot: process.cwd(),
    req: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      socket: { remoteAddress: '203.0.113.9' },
      on() {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(payload, 'utf8');
      },
    },
    res,
    url: new URL(`http://decks.example.test${pathname}`),
    authedUser: { email: 'author@example.com', name: 'Ada Author' },
  });
  return res;
}

const NOT_INSTALLED_THEME = 'not-installed-theme';
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}`;

/** Each internal create route, with an otherwise usable body. */
const ROUTES = [
  { dispatch: handleAi, path: '/api/ai/wizard', body: { raw: 'Een praatje' } },
  {
    dispatch: handleAi,
    path: '/api/ai/wizard-v2/stream',
    body: { raw: 'Een praatje' },
  },
  {
    dispatch: handleConvert,
    path: '/api/convert',
    body: { dataUrl: PDF, filename: 'praatje.pdf' },
  },
  {
    dispatch: handleConvert,
    path: '/api/convert/stream',
    body: { dataUrl: PDF, filename: 'praatje.pdf' },
  },
  {
    dispatch: handleNotion,
    path: '/api/notion/import',
    body: { url: '0123456789abcdef0123456789abcdef' },
    notion: true,
  },
  {
    dispatch: handleNotion,
    path: '/api/notion/import/stream',
    body: { url: '0123456789abcdef0123456789abcdef' },
    notion: true,
  },
];

/** Not a deck language: an unknown tag, the old "detect" sentinel, empty. */
const REFUSED = ['xx-YY', 'auto', '', null];

for (const route of ROUTES) {
  test(`${route.path} refuses an unsupported lang before the work`, async () => {
    if (route.notion) process.env.NOTION_SECRET = 'secret_test_value';
    try {
      for (const lang of REFUSED) {
        const res = await post(route.dispatch, route.path, {
          ...route.body,
          theme: NOT_INSTALLED_THEME,
          lang,
        });
        const label = `${route.path} lang=${JSON.stringify(lang)}`;
        assert.equal(res.statusCode, 400, label);
        assert.equal(res.body?.ok, false, label);
        assert.equal(res.body?.error, 'invalid', label);
        assert.deepEqual(res.body?.details, { field: 'lang' }, label);
      }
    } finally {
      if (route.notion) delete process.env.NOTION_SECRET;
    }
  });
}
