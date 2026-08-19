/**
 * Composing a deck from the slide library: who picks the theme.
 *
 * The server owns the default (`prepareNewPresentation`: sandbox-aware, with
 * the `DEFAULT_THEME` env seam). The client helper therefore sends `theme`
 * only when it actually knows one — a client-side fallback would override
 * the sandbox default and the fork seam with a hardcoded id (it did, with
 * `'deckyard'`, until the amethyst rename removed it).
 *
 * Run with: node --test tests/slide-library-compose-theme.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDeckFromLibraryItems } from '../client/lib/slide-library/compose.js';

function captureApi() {
  const calls = [];
  const api = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { id: 'new' };
  };
  return { api, calls };
}

test('omits theme from the payload when none is known', async () => {
  const { api, calls } = captureApi();
  await createDeckFromLibraryItems({ api, items: [], title: 'T' });
  assert.equal(calls.length, 1);
  assert.ok(!('theme' in calls[0].body), 'no client-side theme fallback — the server decides');
});

test('sends the theme it was given', async () => {
  const { api, calls } = captureApi();
  await createDeckFromLibraryItems({ api, items: [], title: 'T', theme: 'amethyst' });
  assert.equal(calls[0].body.theme, 'amethyst');
});
