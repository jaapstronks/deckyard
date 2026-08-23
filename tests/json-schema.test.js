import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES, getSlideTypeId } from '../shared/slide-types/registry.js';
import { CUSTOM_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';
import {
  fieldToJsonSchema,
  slideTypeContentSchema,
  deckJsonSchema,
} from '../shared/slide-types/json-schema.js';
import {
  TYPE_ID_PATTERN,
  tryParseTypeId,
} from '../shared/slide-types/type-id.js';
import { validate } from './helpers/json-schema-validate.js';

/**
 * Move 1c: the deck JSON Schema is generated from the single field registry.
 * These tests prove the generator covers every declared field type, that the
 * generated deck schema is structurally sound, and - via a small test-only
 * validator - that the schemas actually accept real (default) slide content.
 */

/** Core (non-custom) types, for deterministic assertions across installs. */
const CORE_ENTRIES = Object.entries(SLIDE_TYPES).filter(
  ([name]) => !CUSTOM_SLIDE_TYPE_NAMES.includes(name),
);

// --- generator unit tests -------------------------------------------------

test('fieldToJsonSchema maps every declared field type to a valid base', () => {
  // string-ish types -> type:'string'; images/items -> array.
  const asType = {
    string: 'string',
    markdown: 'string',
    csv: 'string',
    code: 'string',
    color: 'string',
    enum: 'string',
    image: 'string',
    images: 'array',
    items: 'array',
  };
  for (const [type, want] of Object.entries(asType)) {
    assert.equal(fieldToJsonSchema({ type, key: 'x' }).type, want, `${type}`);
  }
  // number/boolean allow the '' cleared value, so they are anyOf wrappers.
  assert.equal(
    fieldToJsonSchema({ type: 'number', key: 'n' }).anyOf[0].type,
    'number',
  );
  assert.equal(
    fieldToJsonSchema({ type: 'boolean', key: 'b' }).anyOf[0].type,
    'boolean',
  );
});

test('field-level constraints flow into the schema', () => {
  assert.equal(
    fieldToJsonSchema({ type: 'string', key: 't', maxLength: 40 }).maxLength,
    40,
  );
  const num = fieldToJsonSchema({ type: 'number', key: 'n', min: 0, max: 100 });
  assert.equal(num.anyOf[0].minimum, 0);
  assert.equal(num.anyOf[0].maximum, 100);
  const imgs = fieldToJsonSchema({ type: 'images', key: 'g', maxItems: 3 });
  assert.equal(imgs.maxItems, 3);
});

test('enum fields list their options plus the cleared-value convention', () => {
  const schema = fieldToJsonSchema({
    type: 'enum',
    key: 'fit',
    options: [
      { value: 'cover', label: 'Fill' },
      { value: 'contain', label: 'Fit' },
    ],
  });
  assert.deepEqual(schema.enum, ['cover', 'contain', '']);
  // The background field stays an open string (theme variant slugs).
  const bg = fieldToJsonSchema({
    type: 'enum',
    key: 'background',
    options: [],
  });
  assert.equal(bg.enum, undefined);
  assert.equal(bg.type, 'string');
});

test('items fields recurse into an object schema shaped by itemFields', () => {
  const schema = fieldToJsonSchema({
    type: 'items',
    key: 'rows',
    minItems: 1,
    maxItems: 5,
    itemFields: [
      { key: 'label', type: 'string', required: true, maxLength: 20 },
      { key: 'value', type: 'number' },
    ],
  });
  assert.equal(schema.type, 'array');
  assert.equal(schema.minItems, 1);
  assert.equal(schema.maxItems, 5);
  assert.equal(schema.items.type, 'object');
  assert.equal(schema.items.properties.label.type, 'string');
  assert.equal(schema.items.properties.label.maxLength, 20);
  assert.equal(schema.items.properties.value.anyOf[0].type, 'number');
  assert.deepEqual(schema.items.required, ['label']);
});

// --- what the schema publishes --------------------------------------------

test('deprecated and hidden fields stay out of the published contract', () => {
  const schema = slideTypeContentSchema('demo-slide', {
    fields: [
      { key: 'title', type: 'string', required: true },
      { key: 'legacyCount', type: 'string', deprecated: true, required: true },
      { key: 'legacyMirror', type: 'string', hidden: true },
      // `ai: false` withholds a field from agents, not from the contract: it is
      // a live field an author fills (see video-slide.watchUrl).
      { key: 'watchUrl', type: 'string', ai: false },
    ],
  });
  assert.deepEqual(Object.keys(schema.properties), ['title', 'watchUrl']);
  // A dropped field cannot be required either.
  assert.deepEqual(schema.required, ['title']);
  // Still lenient: a deck carrying the legacy key validates.
  assert.deepEqual(
    validate(
      schema,
      { title: 'x', legacyCount: '3', legacyMirror: 'y' },
      'demo-slide',
      [],
    ),
    [],
  );
});

test('itemFields are filtered the same way', () => {
  const schema = fieldToJsonSchema({
    type: 'items',
    key: 'rows',
    itemFields: [
      { key: 'label', type: 'string', required: true },
      { key: 'oldLabel', type: 'string', deprecated: true, required: true },
      { key: 'mirror', type: 'string', hidden: true },
    ],
  });
  assert.deepEqual(Object.keys(schema.items.properties), ['label']);
  assert.deepEqual(schema.items.required, ['label']);
});

test('team-cards publishes members[] and nothing numbered beside it', () => {
  // The concrete leak this filter closed: `fields[]` is the editor's list, and
  // it carried card1Image…card25Linkedin beside members[]. Publishing those
  // under `properties` stated the legacy representation as the contract. The
  // family itself is gone since schema v7 -> v8; this pins that the published
  // contract is the array, whatever `fields[]` grows next.
  const schema = slideTypeContentSchema(
    'team-cards-slide',
    SLIDE_TYPES['team-cards-slide'],
  );
  const keys = Object.keys(schema.properties);
  assert.ok(keys.includes('members'), 'the array shape is the contract');
  assert.deepEqual(
    keys.filter((k) => /^card\d/.test(k)),
    [],
  );
  assert.ok(!keys.includes('cardCount'));
});

test('no core type publishes a field it marked deprecated or hidden', () => {
  const leaks = [];
  for (const [name, def] of CORE_ENTRIES) {
    const published = new Set(
      Object.keys(slideTypeContentSchema(name, def).properties),
    );
    for (const field of def.fields || []) {
      if (!field?.key) continue;
      if (field.deprecated !== true && field.hidden !== true) continue;
      if (published.has(field.key)) leaks.push(`${name}.${field.key}`);
    }
  }
  assert.deepEqual(
    leaks,
    [],
    `legacy fields published as contract:\n${leaks.join('\n')}`,
  );
});

// --- deck schema structure ------------------------------------------------

test('the deck schema is self-contained and discriminates content by type', () => {
  const schema = deckJsonSchema(SLIDE_TYPES);
  assert.equal(schema.type, 'object');
  assert.ok(schema.$id.includes('/deck.schema.json'));
  assert.equal(schema.properties.slides.items.$ref, '#/$defs/slide');
  assert.ok(schema.$defs.slide, 'a slide def exists');

  const names = Object.keys(SLIDE_TYPES);
  // Every slide type has a content def and a discriminator branch.
  for (const name of names) {
    const defKey = `content_${name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    assert.ok(schema.$defs[defKey], `missing $defs for ${name}`);
  }
  const branches = schema.$defs.slide.allOf;
  assert.equal(branches.length, names.length);
  for (const branch of branches) {
    const spellings = branch.if.properties.type.enum;
    const ref = branch.then.properties.content.$ref;
    assert.ok(schema.$defs[ref.replace('#/$defs/', '')], `dangling ref ${ref}`);
    // A branch fires on every spelling of one type: the stored key is always
    // among them, and each spelling belongs to exactly one branch (otherwise
    // two content contracts would apply to the same slide).
    assert.ok(
      Array.isArray(spellings) && spellings.length,
      `no spellings on ${ref}`,
    );
    assert.equal(
      spellings.filter((s) => names.includes(s)).length,
      1,
      spellings.join(','),
    );
  }
  const allSpellings = branches.flatMap((b) => b.if.properties.type.enum);
  assert.equal(
    new Set(allSpellings).size,
    allSpellings.length,
    'a spelling may select only one content contract',
  );
});

test('a canonical reverse-DNS type keeps its content contract', () => {
  // The spelling must not decide whether the schema says anything: writing
  // `eu.deckyard.slide.title` instead of `title-slide` is the same type, so the
  // same content shape is demanded of it.
  const schema = deckJsonSchema(SLIDE_TYPES);
  const id = getSlideTypeId('title-slide');
  assert.equal(id, 'eu.deckyard.slide.title');

  for (const type of [id, 'core/title-slide', 'title', 'title-slide']) {
    const good = deckWith({
      id: '9a0b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d',
      type,
      content: SLIDE_TYPES['title-slide'].defaults || {},
    });
    assert.deepEqual(
      validate(schema, good, 'deck', []),
      [],
      `${type} validates`,
    );

    const bad = deckWith({
      id: '9a0b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d',
      type,
      content: { title: 123 },
    });
    assert.ok(
      validate(schema, bad, 'deck', []).length,
      `${type} keeps its shape`,
    );
  }
});

// --- the schema is open, not a list of our own names -----------------------

/** A deck as the schema describes it (the stored model), with one slide. */
function deckWith(slide, extra = {}) {
  return {
    id: '3f1b6a52-0f2a-4a1e-9c3e-2b7a4f5d6e70',
    title: 'Open',
    slides: [slide],
    ...extra,
  };
}

test('a deck carrying an unknown slide type validates', () => {
  // The rule this replaces: `type` was `enum: <this install's registry keys>`,
  // so a deck with a fork type, an org type or any third-party type was invalid
  // against our own published schema while the same spec promises leniency and
  // leaves additionalProperties open everywhere else.
  const schema = deckJsonSchema(SLIDE_TYPES);
  assert.equal(
    schema.$defs.slide.properties.type.enum,
    undefined,
    'no enum of our names',
  );
  assert.ok(schema.$defs.slide.properties.type.pattern, 'a shape instead');

  for (const type of [
    'acme-hero',
    'acme/hero',
    'acme/hero@2',
    'custom-org-thing',
  ]) {
    const deck = deckWith({
      id: '9a0b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d',
      type,
      // Deliberately nothing like any core type's shape: an unknown type
      // matches no `if` branch, so no content contract applies to it.
      content: { whateverTheDeclarantWanted: 42 },
    });
    assert.deepEqual(
      validate(schema, deck, 'deck', []),
      [],
      `${type} should validate`,
    );
  }
});

test('a known type still gets its content contract, and a malformed id is still rejected', () => {
  // Opening the enum must not open the discriminator: the `allOf` branches are
  // what make the schema say anything at all about content.
  const schema = deckJsonSchema(SLIDE_TYPES);
  const good = deckWith({
    id: '9a0b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d',
    type: 'table-slide',
    content: SLIDE_TYPES['table-slide'].defaults || {},
  });
  assert.deepEqual(validate(schema, good, 'deck', []), []);

  const bad = deckWith({
    id: '9a0b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d',
    type: 'title-slide',
    content: { title: 123 },
  });
  assert.ok(
    validate(schema, bad, 'deck', []).length,
    'a known type keeps its shape',
  );

  for (const type of ['Title-Slide', 'a//b', 'acme/hero@', '-leading', '']) {
    const deck = deckWith({
      id: '9a0b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d',
      type,
      content: {},
    });
    assert.ok(
      validate(schema, deck, 'deck', []).length,
      `${JSON.stringify(type)} is not a type id`,
    );
  }
});

test('the type pattern is the parser grammar, not a second copy of it', () => {
  const { pattern } = deckJsonSchema(SLIDE_TYPES).$defs.slide.properties.type;
  assert.equal(pattern, TYPE_ID_PATTERN);
  // Whatever the parser accepts, the published schema accepts, and vice versa.
  const re = new RegExp(pattern);
  for (const ref of [
    'title-slide',
    'acme/hero',
    'acme/hero@2.1',
    'custom-x9',
    // The canonical form, and a third party's. Widening the grammar without
    // widening the published pattern would leave every canonical id invalid
    // against our own schema — the exact failure A8.2 removed for fork types.
    'eu.deckyard.slide.title',
    'eu.deckyard.slide.title@2',
    'nl.ciiic.slide.hero',
    'nl.ciiic.slide/hero',
  ]) {
    assert.ok(tryParseTypeId(ref), `${ref} parses`);
    assert.ok(re.test(ref), `${ref} matches the published pattern`);
  }
  for (const ref of [
    'Title',
    'a b',
    'a/b/c',
    '/x',
    'x@',
    'a.b',
    'a..b',
    '.a.b',
    'a.b.',
  ]) {
    assert.equal(tryParseTypeId(ref), null, `${ref} does not parse`);
    assert.ok(!re.test(ref), `${ref} does not match the published pattern`);
  }
});

test('every registered type name matches the published pattern', () => {
  // Including whatever a fork dropped in custom/slide-types/: a name the schema
  // cannot express is a name no consumer can validate.
  const re = new RegExp(TYPE_ID_PATTERN);
  const unexpressible = Object.keys(SLIDE_TYPES).filter((n) => !re.test(n));
  assert.deepEqual(unexpressible, []);
});

test('lang accepts any BCP 47 tag, not just the two the editor authors in', () => {
  // The app may stay limited to its editor languages (normalizeLang); the
  // published format has no business being. Same CIIIC heritage as the type set.
  const schema = deckJsonSchema(SLIDE_TYPES);
  const lang = schema.properties.lang;
  assert.equal(lang.enum, undefined, 'no two-language enum');
  const re = new RegExp(lang.pattern);
  for (const tag of [
    'nl',
    'en-GB',
    'en',
    'pt-BR',
    'zh-Hant-TW',
    'de-CH-1901',
    'es-419',
    'ja',
  ]) {
    assert.ok(re.test(tag), `${tag} is a well-formed language tag`);
  }
  for (const tag of ['', 'english', 'e', 'nl_NL', 'nl-']) {
    assert.ok(!re.test(tag), `${tag} is not a language tag`);
  }
  const deck = deckWith(
    {
      id: '9a0b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d',
      type: 'end-slide',
      content: SLIDE_TYPES['end-slide'].defaults || {},
    },
    { lang: 'pt-BR' },
  );
  assert.deepEqual(validate(schema, deck, 'deck', []), []);
});

// --- a small, test-only JSON Schema validator -----------------------------
// Extracted to tests/helpers/json-schema-validate.js so the deck-format spec
// test can reuse the exact same conformance check against the same schemas.

test('every core slide type default content validates against its generated schema', () => {
  const failures = [];
  for (const [name, def] of CORE_ENTRIES) {
    const schema = slideTypeContentSchema(name, def);
    const content =
      def.defaultsByLang?.['en-GB'] ||
      def.defaultsByLang?.['nl'] ||
      def.defaults ||
      {};
    const errors = validate(schema, content, name, []);
    if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
  }
  assert.deepEqual(
    failures,
    [],
    `default content failed its schema:\n${failures.join('\n')}`,
  );
});

test('per-type schema with meta carries a versioned $id', () => {
  const [name, def] = CORE_ENTRIES[0];
  const schema = slideTypeContentSchema(name, def, { withMeta: true });
  assert.ok(schema.$schema);
  assert.match(schema.$id, /\/v\d+\/slide-types\/.+\.schema\.json$/);
});
