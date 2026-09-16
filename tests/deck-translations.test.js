/**
 * The portable deck carries every language version, notes, duration and
 * visibility (B249, D89), and Deckyard's own export validates against the one
 * published deck schema (B259, D94).
 *
 *   (a) export → import keeps notes, duration, visibility and every language
 *       version, and the round-trip is a fixpoint after one normalization;
 *   (b) the export of every registered type's sample, in two languages,
 *       validates against the schema `/api/v1/schema/deck.json` serves;
 *   (c) the text-field predicate decides both directions: a machine value
 *       never lands in `translations`, and a translation cannot set one.
 *
 * Run with: node --test tests/deck-translations.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deckImportLang,
  deckToPresentationParts,
  presentationToDeck,
} from '../shared/slide-types/deck.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { deckJsonSchema } from '../shared/slide-types/json-schema.js';
import { slideTypeSample } from '../shared/slide-types/authoring-companions.js';
import {
  applyContentTranslation,
  contentTranslation,
  textFieldSpecForType,
} from '../shared/slide-types/text-fields.js';
import { validate } from './helpers/json-schema-validate.js';

/** Every string leaf prefixed: prose and machine strings alike. */
function prefixStrings(value, prefix) {
  if (typeof value === 'string') return value ? `${prefix}${value}` : value;
  if (Array.isArray(value)) return value.map((v) => prefixStrings(v, prefix));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, prefixStrings(v, prefix)]),
    );
  }
  return value;
}

/**
 * A stored two-language deck: `nl` dominant, an `en-GB` version whose every
 * string differs — including machine strings, which the export must ignore.
 */
function storedDeck(slides) {
  const nl = slides.map((s, i) => ({ id: `slide-${i}`, ...s }));
  const en = nl.map((s) => ({
    ...s,
    content: prefixStrings(s.content, 'EN '),
    notes: s.notes ? `EN ${s.notes}` : '',
  }));
  return {
    title: 'Waarom Deckyard',
    theme: 'default',
    lang: 'nl',
    slides: nl,
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Waarom Deckyard', slides: nl },
        'en-GB': { title: 'Why Deckyard', slides: en },
      },
    },
  };
}

/** What the import routes store from parts (import-json.js, import-deck.js). */
function storedFromParts(parts, lang) {
  return {
    title: parts.title,
    theme: parts.theme,
    lang,
    slides: parts.slides,
    i18n: {
      dominant: lang,
      active: lang,
      versions: {
        ...parts.translations,
        [lang]: { title: parts.title, slides: parts.slides },
      },
    },
  };
}

function roundTrip(stored) {
  const deck = presentationToDeck(stored);
  const resolved = deckImportLang(deck);
  assert.ok(resolved.ok, resolved.message);
  const parts = deckToPresentationParts(deck, { lang: resolved.lang });
  return storedFromParts(parts, resolved.lang);
}

function sampleContent(type) {
  const def = SLIDE_TYPES[type];
  return { ...(def.defaults || {}), ...(slideTypeSample(type, def) || {}) };
}

const TWO_SLIDES = [
  {
    type: 'content-slide',
    content: { title: 'Waarom', body: 'Eén bron.', background: 'lime' },
    notes: 'Hier even stilstaan.',
    duration: 45,
    visibility: { hideInExport: true },
  },
  {
    type: 'text-blocks-slide',
    content: sampleContent('text-blocks-slide'),
    notes: '',
    visibility: {},
  },
];

// --- (a) round-trip --------------------------------------------------------

test('export writes lang, translations, notes, duration and visibility (D89)', () => {
  const deck = presentationToDeck(storedDeck(TWO_SLIDES));
  assert.equal(deck.lang, 'nl');
  assert.deepEqual(deck.translations, { 'en-GB': { title: 'Why Deckyard' } });

  const [first, second] = deck.slides;
  assert.equal(first.notes, 'Hier even stilstaan.');
  assert.equal(first.duration, 45);
  assert.deepEqual(first.visibility, { hideInExport: true });
  assert.deepEqual(first.translations, {
    'en-GB': {
      title: 'EN Waarom',
      body: 'EN Eén bron.',
      notes: 'EN Hier even stilstaan.',
    },
  });

  // Unset slide keys stay off the wire.
  assert.equal(second.notes, undefined);
  assert.equal(second.visibility, undefined);
  assert.equal(second.duration, undefined);
  // An items array becomes an equally long, text-only array — at every level.
  const rows = second.content.rows;
  const trRows = second.translations['en-GB'].rows;
  assert.ok(Array.isArray(rows) && rows.length > 0, 'the sample has rows');
  assert.equal(trRows.length, rows.length);
});

test('export → import keeps every language version, notes, duration and visibility', () => {
  const stored = storedDeck(TWO_SLIDES);
  const imported = roundTrip(stored);

  assert.equal(imported.i18n.dominant, 'nl');
  const en = imported.i18n.versions['en-GB'];
  assert.ok(en, 'the en-GB version was imported');
  assert.equal(en.title, 'Why Deckyard');

  const [first] = imported.slides;
  assert.equal(first.notes, 'Hier even stilstaan.');
  assert.equal(first.duration, 45);
  assert.deepEqual(first.visibility, { hideInExport: true });

  const [enFirst, enSecond] = en.slides;
  assert.equal(enFirst.id, first.id, 'versions share slide ids');
  assert.equal(enFirst.content.title, 'EN Waarom');
  assert.equal(enFirst.content.body, 'EN Eén bron.');
  assert.equal(enFirst.content.background, 'lime', 'machine value from base');
  assert.equal(enFirst.notes, 'EN Hier even stilstaan.');
  assert.equal(enFirst.duration, 45);
  assert.deepEqual(enFirst.visibility, { hideInExport: true });

  // Nested item text survives too (text-blocks-slide rows[].blocks[]).
  const block = enSecond.content.rows?.[0]?.blocks?.[0];
  const sourceBlock = TWO_SLIDES[1].content.rows?.[0]?.blocks?.[0];
  assert.ok(sourceBlock?.title, 'the sample has a nested block title');
  assert.equal(block.title, `EN ${sourceBlock.title}`);
});

test('the round-trip is a fixpoint after one normalization', () => {
  const once = roundTrip(storedDeck(TWO_SLIDES));
  const twice = roundTrip(once);
  assert.deepEqual(presentationToDeck(twice), presentationToDeck(once));
});

test('a deck in one language exports without translations', () => {
  const deck = presentationToDeck({
    title: 'Solo',
    theme: 'default',
    slides: [{ type: 'content-slide', content: { title: 'x' } }],
  });
  assert.equal(deck.translations, undefined);
  assert.equal(deck.slides[0].translations, undefined);
  const parts = deckToPresentationParts(deck, { lang: 'nl' });
  assert.deepEqual(parts.translations, {});
});

test('deckImportLang: the deck names its language; contradictions are refused', () => {
  assert.deepEqual(deckImportLang({ lang: 'nl' }), { ok: true, lang: 'nl' });
  assert.deepEqual(deckImportLang({}, 'de'), { ok: true, lang: 'de' });
  assert.deepEqual(deckImportLang({ lang: 'de' }, 'de'), {
    ok: true,
    lang: 'de',
  });
  assert.equal(deckImportLang({ lang: 'nl' }, 'de').ok, false);
  assert.equal(deckImportLang({ lang: 'pt-BR' }).ok, false);
  assert.equal(
    deckImportLang({ lang: 'nl', translations: { nl: { title: 'x' } } }).ok,
    false,
    'a translation into the deck language',
  );
  assert.equal(
    deckImportLang({
      lang: 'nl',
      slides: [
        { type: 'content-slide', content: {}, translations: { xx: {} } },
      ],
    }).ok,
    false,
    'an unsupported translation language on a slide',
  );
});

// --- (b) the export validates against the published schema -----------------

test('the two-language export of every type sample validates against deck.json', () => {
  const schema = deckJsonSchema(SLIDE_TYPES);
  const failures = [];
  for (const type of Object.keys(SLIDE_TYPES).sort()) {
    const deck = presentationToDeck(
      storedDeck([
        {
          type,
          content: sampleContent(type),
          notes: 'Notitie',
          duration: 30,
          visibility: { hideInPublished: true },
        },
      ]),
    );
    const errors = validate(schema, deck, type, []);
    if (errors.length) failures.push(...errors);
  }
  assert.deepEqual(failures, []);
});

test('the schema describes the envelope, not the stored model (D94)', () => {
  const schema = deckJsonSchema(SLIDE_TYPES);
  for (const key of ['id', 'schemaVersion', 'created', 'modified', 'settings'])
    assert.equal(schema.properties[key], undefined, `no stored-model ${key}`);
  assert.equal(schema.$defs.slide.properties.id, undefined, 'no slide id');
  assert.deepEqual(schema.required, ['format', 'version', 'title', 'slides']);

  const bad = presentationToDeck(storedDeck(TWO_SLIDES));
  bad.slides[0].translations['en-GB'].title = 42;
  assert.ok(
    validate(schema, bad, 'deck', []).length,
    'a translation keeps its type contract',
  );
});

// --- (c) one predicate, both directions ------------------------------------

test('no registered type declares a content field named `notes`', () => {
  // Inside a slide translation `notes` is the slide's notes; a content key of
  // the same name could not be told apart.
  const clashes = Object.entries(SLIDE_TYPES)
    .filter(([, def]) => (def.fields || []).some((f) => f?.key === 'notes'))
    .map(([name]) => name);
  assert.deepEqual(clashes, []);
});

test('a machine value never lands in translations', () => {
  const leaks = [];
  for (const type of Object.keys(SLIDE_TYPES).sort()) {
    const def = SLIDE_TYPES[type];
    const spec = textFieldSpecForType(type);
    const base = sampleContent(type);
    const tr = contentTranslation(spec, base, prefixStrings(base, 'EN '));
    for (const field of def.fields || []) {
      if (!(field.key in tr)) continue;
      if (field.type === 'items') continue; // checked per item below
      if (!spec.textKeys.has(field.key)) leaks.push(`${type}.${field.key}`);
    }
    // Every leaf of a translation is a string: arrays and objects only frame it.
    const walk = (v, path) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      else if (typeof v !== 'string') leaks.push(`${path} = ${v}`);
    };
    walk(tr, type);
  }
  assert.deepEqual(leaks, []);
});

test('an enum, image or number in a translation is ignored on import', () => {
  const spec = textFieldSpecForType('content-slide');
  const base = { title: 'Waarom', body: 'Tekst', background: 'lime' };
  const out = applyContentTranslation(spec, base, {
    title: 'Why',
    background: 'navy',
  });
  assert.deepEqual(out, { title: 'Why', body: '', background: 'lime' });
});
