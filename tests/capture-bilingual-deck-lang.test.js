/**
 * A bilingual marketing deck is created in its dominant language (B654).
 *
 * A save cannot change a deck's language (B608, `save-presentation.js`), so
 * `seedBilingualDeck()` has to name the language at creation. When it created
 * the deck in the installation default and set `lang` in the follow-up PUT,
 * every `en-GB` marketing shot failed on an `nl` installation with
 * "lang cannot be changed" (five recipes in the v1.56.0 capture run).
 *
 * The client below is a recording double: it answers the three calls the
 * seeder makes and keeps what was sent, so the test reads the request rather
 * than a server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { seedBilingualDeck } from '../capture/lib/marketing.js';

function recordingApi() {
  const calls = [];
  let created = null;
  return {
    calls,
    base: 'http://test',
    async get(path) {
      calls.push({ method: 'GET', path });
      if (path === '/api/themes') {
        return { themes: [{ id: 'theme-1', source: 'seed', slug: 'calm' }] };
      }
      // A server stores the language it was given, else its default.
      return { id: 'deck-1', revision: 1, lang: created?.lang || 'nl' };
    },
    async post(path, body) {
      calls.push({ method: 'POST', path, body });
      created = body;
      return { id: 'deck-1' };
    },
    async put(path, body) {
      calls.push({ method: 'PUT', path, body });
      return {};
    },
  };
}

for (const dominant of ['nl', 'en-GB']) {
  test(`seedBilingualDeck creates a ${dominant} deck in ${dominant}`, async () => {
    const api = recordingApi();
    await seedBilingualDeck(api, {
      title: 'Deck',
      themeSlug: 'calm',
      dominant,
      titles: { nl: 'Deck', 'en-GB': 'Deck' },
      versions: { nl: [], 'en-GB': [] },
    });
    const post = api.calls.find((c) => c.method === 'POST');
    const put = api.calls.find((c) => c.method === 'PUT');
    assert.equal(post.body.lang, dominant);
    assert.equal(put.body.lang, dominant, 'the PUT keeps the created language');
  });
}
