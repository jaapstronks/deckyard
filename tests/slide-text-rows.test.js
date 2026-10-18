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

test('a presentational field is neither a row nor a missing count (B770)', () => {
  // `icon` on icon-cards stores a lookup key into the icon set ("rocket"), so
  // the flag says machine data. Before B770 the walk read only the field type,
  // so the language menu counted the icon as untranslated, the translate view
  // offered a row for it, and machine translation would have rendered it into
  // Dutch — leaving the card with no icon at all.
  const deck = {
    title: 'Deck',
    slides: [
      {
        id: 'i',
        type: 'icon-card-grid-slide',
        content: {
          title: 'Waarom',
          items: [{ icon: 'rocket', title: 'Snel', text: 'Binnen een dag' }],
        },
      },
    ],
  };
  const paths = slideTextRows(deck, { slides: [] })
    .filter((r) => r.kind === 'slide')
    .map((r) => r.path.join('.'));
  assert.ok(
    !paths.includes('items.0.icon'),
    `the icon name is offered as a text row: ${paths.join(', ')}`,
  );
  // The card's own prose is still there — only the lookup key is gone.
  assert.deepEqual(
    paths.filter((p) => p.startsWith('items.')),
    ['items.0.title', 'items.0.body', 'items.0.text'],
  );
  // Deck title, slide title and the card's two filled texts: four, not five.
  assert.equal(
    computeMissingTranslation({ source: deck, target: {} }).missingCount,
    4,
  );
});

test('interactionCopy stays prose: the feedback placeholder is a row (B770)', () => {
  // The counterpart of the test above, and the reason the two claims are
  // separate declarations. The placeholder is the hint inside the audience's
  // input box — no reader prints it — but it is prose a human wrote, and the
  // type ships a Dutch and an English default for it. Reading it as machine
  // data would hand both languages one value and silently drop the other.
  const deck = {
    title: 'Deck',
    slides: [
      {
        id: 'f',
        type: 'feedback-slide',
        content: {
          question: 'Wat wil je ons meegeven?',
          placeholder: 'Typ je feedback…',
        },
      },
    ],
  };
  const paths = slideTextRows(deck, { slides: [] })
    .filter((r) => r.kind === 'slide')
    .map((r) => r.path.join('.'));
  assert.ok(
    paths.includes('placeholder'),
    `the placeholder is not offered for translation: ${paths.join(', ')}`,
  );
  // Deck title, question and placeholder.
  assert.equal(
    computeMissingTranslation({ source: deck, target: {} }).missingCount,
    3,
  );
});
