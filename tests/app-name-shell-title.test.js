/**
 * B566: the sign-in screens title their tab with `APP_NAME`. They never fetch
 * /me, so the name cannot come from the feature flags; the server writes it
 * into the served shell (`<title>` and `<meta name="application-name">`,
 * `injectAppName` in server/routes/static/app-shell.js) and the client reads
 * the meta (`client/lib/theme/branding.js`). Unset, the tab says "Deckyard".
 *
 * Run with: node --test tests/app-name-shell-title.test.js
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import {
  injectAppName,
  readIndexHtml,
} from '../server/routes/static/app-shell.js';

const clientDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'client',
);

const ORIGINAL = process.env.APP_NAME;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_NAME;
  else process.env.APP_NAME = ORIGINAL;
  delete globalThis.document;
});

/**
 * The shell as `/login` serves it, loaded into a DOM with no session and no
 * feature flags, then titled the way the router titles every route.
 * @returns {Promise<{ served: string, titled: string }>}
 */
async function loginPage() {
  const html = injectAppName(await readIndexHtml(clientDir));
  const dom = new JSDOM(html, { url: 'http://localhost/login' });
  globalThis.document = dom.window.document;
  const { setDocumentTitle } = await import('../client/lib/theme/branding.js');
  const served = dom.window.document.title;
  setDocumentTitle();
  return { served, titled: dom.window.document.title };
}

test('the shell carries one <title> and one application-name meta to rewrite', async () => {
  const html = await readIndexHtml(clientDir);
  assert.equal(html.match(/<title>[^<]*<\/title>/g)?.length, 1);
  assert.equal(
    html.match(/<meta name="application-name" content="[^"]*" \/>/g)?.length,
    1,
  );
});

test('with APP_NAME, /login without a session titles its tab with it', async () => {
  process.env.APP_NAME = 'Dreamkit Slides';
  const { served, titled } = await loginPage();
  assert.equal(served, 'Dreamkit Slides', 'the served <title>');
  assert.equal(titled, 'Dreamkit Slides', 'after the router sets the title');
});

test('without APP_NAME the tab stays "Deckyard"', async () => {
  delete process.env.APP_NAME;
  const { served, titled } = await loginPage();
  assert.equal(served, 'Deckyard');
  assert.equal(titled, 'Deckyard');
});

test('a $ in the name is text, not a replacement pattern', () => {
  process.env.APP_NAME = "$& $1 $' Slides";
  const html = injectAppName(
    '<title>Deckyard</title>\n<meta name="application-name" content="Deckyard" />',
  );
  assert.equal(
    html,
    '<title>$&amp; $1 $&#039; Slides</title>\n' +
      '<meta name="application-name" content="$&amp; $1 $&#039; Slides" />',
  );
});

test('the name is escaped into the head', () => {
  process.env.APP_NAME = 'A&B "Slides" <x>';
  const html = injectAppName(
    '<title>Deckyard</title>\n<meta name="application-name" content="Deckyard" />',
  );
  assert.equal(
    html,
    '<title>A&amp;B &quot;Slides&quot; &lt;x&gt;</title>\n' +
      '<meta name="application-name" content="A&amp;B &quot;Slides&quot; &lt;x&gt;" />',
  );
});
