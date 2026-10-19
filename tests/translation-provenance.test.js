import test from 'node:test';
import assert from 'node:assert/strict';
import {
  translationFieldKey,
  translationSource,
  translationSourceHash,
  translationFieldStatus,
  recordTranslatedVersion,
} from '../shared/translation-provenance.js';
import { migratePresentation } from '../shared/slide-types/schema-version.js';

const slide = (title, item) => ({
  id: 's1',
  type: 'list-slide',
  content: {
    title,
    items: [
      { title: item, text: '' },
      { title: '', text: '' },
    ],
  },
});

test('exact text and source language decide status; equality has precedence', () => {
  const record = translationSource('nl', 'Bron 👋');
  assert.equal(translationSourceHash('Bron 👋'), record.hash);
  assert.notEqual(translationSourceHash('Bron 👋 '), record.hash);
  for (const [row, lang, status] of [
    [{ source: 'Bron 👋', target: 'Source' }, 'nl', 'current'],
    [{ source: 'Nieuwe bron', target: 'Source' }, 'nl', 'changed'],
    [{ source: 'Bron 👋', target: 'Source' }, 'de', 'untracked'],
    [{ source: 'Bron 👋', target: 'Bron 👋' }, 'nl', 'same'],
    [{ source: 'Bron 👋', target: ' ' }, 'nl', 'empty'],
  ])
    assert.equal(translationFieldStatus(row, lang, record), status);
  assert.equal(
    translationFieldStatus({ source: 'Bron', target: 'Source' }, 'nl'),
    'untracked',
  );
});

test('filling missing text retains old provenance and stamps only newly filled nested text', () => {
  const source = { title: 'Deck', slides: [slide('Waarom', 'Snel')] };
  const key = translationFieldKey('s1', ['title']);
  const old = translationSource('de', 'An older source');
  const previous = {
    title: 'Deck EN',
    slides: [slide('Why', '')],
    translationSources: { [key]: old },
  };
  const target = { title: 'Deck EN', slides: [slide('Why', 'Fast')] };
  recordTranslatedVersion(source, target, 'nl', { previous });
  assert.deepEqual(target.translationSources[key], old);
  assert.deepEqual(
    target.translationSources[translationFieldKey('s1', ['items', 0, 'title'])],
    translationSource('nl', 'Snel'),
  );
  assert.equal(
    target.translationSources[translationFieldKey(null, ['title'])],
    undefined,
  );
  assert.notEqual(target.translationSources, previous.translationSources);
});

test('the schema step leaves existing decks without invented history', () => {
  const deck = {
    title: 'Old deck',
    slides: [],
    i18n: {
      dominant: 'nl',
      versions: {
        nl: { title: 'Oud', slides: [] },
        'en-GB': { title: 'Old', slides: [] },
      },
    },
  };
  const migrated = migratePresentation(deck);
  for (const version of Object.values(migrated.i18n.versions))
    assert.equal(version.translationSources, undefined);
  assert.deepEqual(migratePresentation(migrated), migrated);
});
