import test from 'node:test';
import assert from 'node:assert/strict';

import { listFidelity } from '../test-suite/eval/metrics.js';

const groups = {
  label: 'Doelgroepen',
  members: [['mkb'], ['zelfstandig', 'zzp'], ['mbo', 'hbo']],
};

const listSlide = (...titles) => ({
  type: 'list-slide',
  content: {
    title: 'Beoogde doelgroepen',
    items: titles.map((title) => ({ title, text: '' })),
  },
});

test('a list with exactly the members the source names passes', () => {
  const r = listFidelity(
    { slides: [listSlide('Mkb-bedrijven', "Zzp'ers", 'Mbo en hbo')] },
    [groups],
  );
  assert.equal(r.passed, 1);
  assert.equal(r.lists[0].count, 3);
  assert.deepEqual(r.lists[0].strays, []);
});

test('remarks about the list posing as items fail and are named (B596)', () => {
  // The import that minted B596: three target groups became five items.
  const r = listFidelity(
    {
      slides: [
        listSlide(
          'Mkb-bedrijven',
          "Zzp'ers",
          'Mbo en hbo',
          'Doel: ketendekking',
          'Implicatie voor ontwerp',
        ),
      ],
    },
    [groups],
  );
  assert.equal(r.passed, 0);
  assert.equal(r.lists[0].found, true, 'every member is there');
  assert.equal(r.lists[0].count, 5);
  assert.deepEqual(r.lists[0].strays, [
    'Doel: ketendekking',
    'Implicatie voor ontwerp',
  ]);
});

test('an item that names several members is a summary, not a member', () => {
  const r = listFidelity(
    {
      slides: [
        listSlide('Mkb-bedrijven', "Zzp'ers", 'Mbo en hbo', 'Mkb, zzp en mbo'),
      ],
    },
    [groups],
  );
  assert.equal(r.lists[0].ok, false);
  assert.equal(r.lists[0].strays.length, 1);
});

test('a missing member is a fail, wherever the others ended up', () => {
  const r = listFidelity({ slides: [listSlide('Mkb-bedrijven', "Zzp'ers")] }, [
    groups,
  ]);
  assert.equal(r.lists[0].found, false);
  assert.equal(r.passed, 0);
});

test('blocks of one text-blocks row are judged as their own collection', () => {
  const deck = {
    slides: [
      {
        type: 'text-blocks-slide',
        content: {
          title: 'Doelgroepen en effect',
          rows: [
            {
              title: 'Doelgroepen',
              blocks: [
                { title: 'Mkb', body: '' },
                { title: 'Zzp', body: '' },
                { title: 'Hbo', body: '' },
              ],
            },
            { title: 'Effect', blocks: [{ title: 'Toepassing', body: '' }] },
          ],
        },
      },
    ],
  };
  assert.equal(listFidelity(deck, [groups]).passed, 1);
});

test('markdown bullets count when a slide has no structured items', () => {
  const deck = {
    slides: [
      {
        type: 'content-slide',
        content: { title: 'Doelgroepen', body: '- Mkb\n- Zzp\n- Mbo' },
      },
    ],
  };
  assert.equal(listFidelity(deck, [groups]).passed, 1);
});

test('a case declaring no lists reports nothing', () => {
  assert.deepEqual(listFidelity({ slides: [] }, []), {
    expected: 0,
    passed: 0,
    lists: [],
  });
});

test('a list that is not there names no strays from another collection', () => {
  const r = listFidelity(
    { slides: [listSlide('Doel', 'Effect', 'Mkb-bedrijven')] },
    [groups],
  );
  assert.equal(r.lists[0].found, false);
  assert.deepEqual(r.lists[0].strays, []);
});
