/**
 * The fill-from-translation shot seeds its photographed slide untranslated
 * (B886, DY-777).
 *
 * With every target field already filled, the stub's suggestion repeated the
 * target text word for word and the shot showed no translation work at all.
 * `seedMarketingDeck(..., { untranslated })` stores the non-dominant version of
 * the named slides with their prose empty, keeps the dominant version whole,
 * and still returns the full translation for the stub to answer with.
 *
 * The client below is a recording double, like the one in
 * `capture-bilingual-deck-lang.test.js`: the test reads the stored request.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { seedMarketingDeck } from '../capture/recipes/_marketing-deck.js';

function recordingApi() {
  const puts = [];
  let created = null;
  return {
    puts,
    base: 'http://test',
    async get(path) {
      if (path === '/api/themes') {
        return { themes: [{ id: 'theme-1', source: 'seed', slug: 'brand' }] };
      }
      if (path.startsWith('/api/presentations?')) return { presentations: [] };
      return { id: 'deck-1', revision: 1, lang: created?.lang || 'nl' };
    },
    async post(path, body) {
      created = body;
      return { id: 'deck-1' };
    },
    async put(path, body) {
      puts.push({ path, body });
      return {};
    },
    async del() {
      return {};
    },
  };
}

test('an untranslated slide is stored empty in the target version only', async () => {
  const api = recordingApi();
  const { deck } = await seedMarketingDeck(api, 'en', {
    dominant: 'nl',
    untranslated: ['funnel'],
  });
  const saved = api.puts.find((p) => p.path === '/api/presentations/deck-1');
  const versions = saved.body.i18n.versions;
  const id = deck.slideIds.funnel;
  const target = versions['en-GB'].slides.find((s) => s.id === id);
  const source = versions.nl.slides.find((s) => s.id === id);

  assert.equal(target.content.title, '');
  assert.equal(target.content.bottomSubheading, '');
  assert.ok(target.content.items.length > 0);
  for (const item of target.content.items) {
    assert.equal(item.label, '');
    assert.equal(item.text, '');
  }
  // A setting is not prose: the background survives.
  assert.equal(target.content.background, source.content.background);
  assert.equal(source.content.title, 'Van voorbijganger tot vaste klant');

  // Other slides of the target version keep their translation.
  const other = versions['en-GB'].slides.find(
    (s) => s.id === deck.slideIds.kpi,
  );
  assert.ok(other.content.title);

  // The returned deck is the full translation the stub answers with.
  const full = deck.versions['en-GB'].find((s) => s.id === id);
  assert.equal(full.content.title, 'From passer-by to regular');
});
