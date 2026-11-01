import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyListVerdict,
  deckItemLists,
  judgeListKinship,
  renderListsForJudge,
} from '../test-suite/eval/judge-lists.js';

const listSlide = (title, subheading, ...titles) => ({
  type: 'list-slide',
  content: {
    title,
    subheading,
    items: titles.map((t) => ({ title: t, text: '' })),
  },
});

const deck = {
  slides: [
    { type: 'title-slide', content: { title: 'Plan' } },
    listSlide('Waar gaat het om?', 'Op een rij:', 'Doel', 'Status', 'Rol'),
    listSlide('Twee routes', '', 'Via werkgevers', 'Via professionals'),
    listSlide('Doelgroepen', '', 'Mkb', "Zzp'ers", 'Onderwijs'),
  ],
};

test('every collection of three or more items is a list, numbered in deck order', () => {
  const lists = deckItemLists(deck);
  assert.deepEqual(
    lists.map((l) => [l.id, l.slide, l.title]),
    [
      [1, 2, 'Waar gaat het om?'],
      [2, 4, 'Doelgroepen'],
    ],
  );
  assert.equal(lists[0].subheading, 'Op een rij:');
  assert.deepEqual(lists[1].items, ['Mkb', "Zzp'ers", 'Onderwijs']);
});

test('the rendering gives the judge heading, subheading and items', () => {
  const text = renderListsForJudge(deckItemLists(deck));
  assert.match(text, /List 1 \(slide 2, list-slide\)/);
  assert.match(text, /Heading: Waar gaat het om\?/);
  assert.match(text, /Subheading: Op een rij:/);
  assert.match(text, /- Status/);
});

test('a mixed verdict is counted and keeps its kinds and rationale', () => {
  const result = applyListVerdict(deckItemLists(deck), {
    lists: [
      {
        id: 1,
        alike: false,
        kinds: ['doel', 'status', 'rol'],
        strays: [],
        rationale: 'Maak hier lopende tekst van.',
      },
      { id: 2, alike: true, kinds: ['doelgroep'], strays: [], rationale: '' },
    ],
  });
  assert.equal(result.total, 2);
  assert.equal(result.judged, 2);
  assert.equal(result.mixed, 1);
  assert.deepEqual(result.lists[0].kinds, ['doel', 'status', 'rol']);
});

test('a skipped list is not judged, and an unknown id does not count', () => {
  const result = applyListVerdict(deckItemLists(deck), {
    lists: [
      { id: 2, alike: true, kinds: ['doelgroep'], strays: [], rationale: '' },
      { id: 9, alike: false, kinds: [], strays: [], rationale: '' },
    ],
  });
  assert.equal(result.total, 2);
  assert.equal(result.judged, 1);
  assert.equal(result.mixed, 0);
  assert.equal(result.lists[0].judged, false);
  assert.equal(result.lists[0].alike, undefined);
});

test('a deck without lists is settled without a model call', async () => {
  const { result, cached } = await judgeListKinship({
    deck: { slides: [{ type: 'title-slide', content: { title: 'Plan' } }] },
  });
  assert.deepEqual(result, { total: 0, judged: 0, mixed: 0, lists: [] });
  assert.equal(cached, false);
});
