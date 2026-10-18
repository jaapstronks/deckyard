/**
 * `slideTextRows` is the one walk over the text of a deck in two languages,
 * and the missing-translation scan is a filter on it (B762): the translation
 * view lists the rows, the progress counters count the empty targets, and the
 * two cannot drift apart.
 *
 * Run with: node --test tests/slide-text-rows.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMissingTranslation,
  slideTextRows,
} from '../shared/i18n-progress.js';

const source = {
  title: 'Deck',
  slides: [
    {
      id: 'a',
      type: 'list-slide',
      content: {
        title: 'Waarom',
        items: [
          { title: 'Snel', text: 'Binnen een dag' },
          { title: 'Open', text: '' },
        ],
      },
    },
    {
      id: 'b',
      type: 'text-blocks-slide',
      content: {
        rows: [{ blocks: [{ title: 'Blok', body: 'Tekst' }] }],
      },
    },
  ],
};

const target = {
  title: '',
  slides: [
    {
      id: 'a',
      type: 'list-slide',
      content: {
        title: 'Why',
        items: [{ title: 'Fast', text: '' }],
      },
    },
  ],
};

const pathKey = (r) => `${r.slideId ?? 'deck'}:${r.path.join('.')}`;

test('rows carry every text path with both values, deck title first', () => {
  const rows = slideTextRows(source, target);
  assert.deepEqual(rows[0], {
    kind: 'deck',
    slideId: null,
    slideIndex: null,
    type: '',
    key: 'title',
    path: ['title'],
    source: 'Deck',
    target: '',
  });
  const byPath = new Map(rows.map((r) => [pathKey(r), r]));
  assert.equal(byPath.get('a:title').target, 'Why');
  assert.equal(byPath.get('a:items.0.title').target, 'Fast');
  assert.equal(byPath.get('a:items.1.title').source, 'Open');
  assert.equal(byPath.get('a:items.1.title').target, '', 'absent item → ""');
  assert.equal(
    byPath.get('b:rows.0.blocks.0.body').source,
    'Tekst',
    'nested items are walked',
  );
  assert.ok(byPath.has('a:items.1.text'), 'an empty source text is a row too');
});

test('the missing scan is exactly the rows with a filled source and an empty target', () => {
  const rows = slideTextRows(source, target).filter(
    (r) => r.source.trim() && !r.target.trim(),
  );
  const { missing, missingCount } = computeMissingTranslation({
    source,
    target,
  });
  assert.equal(missingCount, rows.length);
  assert.deepEqual(
    missing.map((m) => (m.kind === 'deck' ? 'deck:title' : pathKey(m))),
    rows.map(pathKey),
  );
  assert.deepEqual(missing[0], { kind: 'deck', key: 'title' });
  assert.deepEqual(Object.keys(missing[1]).sort(), [
    'key',
    'kind',
    'path',
    'slideId',
    'slideIndex',
    'type',
  ]);
});

test('a custom slide-type registry decides the fields of its own type', () => {
  const slideTypes = {
    'acme-slide': {
      fields: [
        { key: 'headline', type: 'string' },
        { key: 'tone', type: 'enum', options: ['calm', 'loud'] },
        {
          key: 'steps',
          type: 'items',
          itemFields: [{ key: 'label', type: 'string' }],
        },
      ],
    },
  };
  const deck = {
    title: '',
    slides: [
      {
        id: 'c',
        type: 'acme-slide',
        content: { headline: 'Hoi', tone: 'calm', steps: [{ label: 'Eén' }] },
      },
    ],
  };
  const paths = slideTextRows(deck, { slides: [] }, { slideTypes })
    .filter((r) => r.kind === 'slide')
    .map((r) => r.path.join('.'));
  assert.deepEqual(paths, ['headline', 'steps.0.label']);
  assert.equal(
    computeMissingTranslation({ source: deck, target: {}, slideTypes })
      .missingCount,
    2,
  );

  // Without the registry the type is unknown: its item texts are invisible.
  const corePaths = slideTextRows(deck, { slides: [] })
    .filter((r) => r.kind === 'slide')
    .map((r) => r.path.join('.'));
  assert.ok(!corePaths.includes('steps.0.label'));
});
