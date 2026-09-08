/**
 * One walk over `fields[]`, two surfaces (B231).
 *
 * The database builder and the boot-time definition check used to carry their
 * own copy of "what a field declaration must look like", and the copies had
 * drifted in three measurable ways: an `enum` whose options normalize to
 * nothing, an `items` field with an empty `itemFields` array, and anything
 * nested two levels deep. `shared/slide-types/field-definitions.js` is the one
 * walk both now run.
 *
 * Pinned here:
 *  1. one rule set, two type vocabularies — the same malformed field is refused
 *     on both surfaces, and only the accepted `type` list differs;
 *  2. one finding shape — every finding carries both renderings of its place
 *     (`path` for a log, `name` for a form) and the coordinates the builder
 *     opens;
 *  3. the A2.1–A2.3 declarations (`itemLabelField`, `mediaRef`,
 *     `foldUnofferedTo`) are checked beside the field that declares them, at
 *     every depth, and stay warnings;
 *  4. the DB surface answers with the FIRST error, the boot surface with all of
 *     them — that split is the callers', not the walk's;
 *  5. the stored vocabulary is a contract (D84): a property a DB row may not
 *     carry is refused and located, not dropped on the way to storage, while
 *     hand-written source stays open.
 *
 * Run with: node --test tests/field-definition-rules.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeFieldFinding,
  walkFieldDefinitions,
} from '../shared/slide-types/field-definitions.js';
import {
  CUSTOM_TYPE_FIELD_TYPES,
  MAX_CUSTOM_TYPE_FIELDS,
  validateCustomFieldDefinitions,
} from '../shared/slide-types/custom-field-definitions.js';
import { FIELD_TYPE_NAMES } from '../shared/slide-types/field-types.js';
import { validateSlideTypeDefinition } from '../shared/slide-types/validate-definition.js';

/** The two live profiles, named the way the two callers configure them. */
const DB = {
  fieldTypes: CUSTOM_TYPE_FIELD_TYPES,
  maxFields: MAX_CUSTOM_TYPE_FIELDS,
  labelSeverity: 'error',
};
const FILE_JS = { fieldTypes: FIELD_TYPE_NAMES };

const codes = (fields, profile) =>
  walkFieldDefinitions(fields, profile).findings.map((f) => f.code);

const errors = (fields, profile) =>
  walkFieldDefinitions(fields, profile)
    .findings.filter((f) => f.severity === 'error')
    .map((f) => f.code);

// --- 1. one rule set, two vocabularies -------------------------------------

/**
 * Structure rules that must hold identically on both surfaces. Only the
 * `type` vocabulary is allowed to differ, and it is checked separately below.
 */
const SHARED_RULES = [
  ['a list that is not an array', { a: 1 }, 'not_an_array'],
  ['a field that is not an object', [null], 'not_an_object'],
  ['a field without a key', [{ type: 'string', label: 'A' }], 'missing_key'],
  [
    'two fields with the same key',
    [
      { key: 'a', type: 'string', label: 'A' },
      { key: 'a', type: 'markdown', label: 'B' },
    ],
    'duplicate_key',
  ],
  ['a field without a type', [{ key: 'a', label: 'A' }], 'missing_type'],
  [
    'an enum whose options are all malformed',
    [{ key: 'a', type: 'enum', label: 'A', options: [null, {}] }],
    'enum_without_options',
  ],
  [
    'an items field with an empty itemFields',
    [{ key: 'a', type: 'items', label: 'A', itemFields: [] }],
    'items_without_item_fields',
  ],
  [
    'an items field with no itemFields at all',
    [{ key: 'a', type: 'items', label: 'A' }],
    'items_without_item_fields',
  ],
];

for (const [why, fields, code] of SHARED_RULES) {
  test(`both surfaces refuse ${why}`, () => {
    assert.ok(errors(fields, DB).includes(code), `db: ${why}`);
    assert.ok(errors(fields, FILE_JS).includes(code), `file-js: ${why}`);
  });
}

test('the type vocabulary is the one thing the two surfaces disagree on', () => {
  const fields = [{ key: 'n', type: 'number', label: 'N' }];
  assert.deepEqual(errors(fields, DB), ['unknown_type']);
  assert.deepEqual(errors(fields, FILE_JS), []);
  // ...and the sentence names the vocabulary that refused it, not a fixed list.
  const [finding] = walkFieldDefinitions(fields, DB).findings;
  assert.deepEqual(finding.detail.offered, CUSTOM_TYPE_FIELD_TYPES);
  assert.match(describeFieldFinding(finding), /"number"/);
});

test('a missing label is refused by the builder and only noted at boot', () => {
  const fields = [{ key: 'a', type: 'string' }];
  const db = walkFieldDefinitions(fields, DB).findings;
  const boot = walkFieldDefinitions(fields, FILE_JS).findings;
  assert.deepEqual(
    db.map((f) => [f.code, f.severity]),
    [['missing_label', 'error']],
  );
  assert.deepEqual(
    boot.map((f) => [f.code, f.severity]),
    [['missing_label', 'warning']],
  );
  // The severity is the difference, so the sentence draws the consequence the
  // severity implies: a refusal states the fact, a warning says what degrades.
  assert.equal(describeFieldFinding(db[0]), '"a" has no label.');
  assert.match(describeFieldFinding(boot[0]), /shows its bare key instead\.$/);
});

test('only the database surface is bounded in size', () => {
  const many = Array.from({ length: MAX_CUSTOM_TYPE_FIELDS + 1 }, (_, i) => ({
    key: `f${i}`,
    type: 'string',
    label: `F${i}`,
  }));
  assert.deepEqual(errors(many, DB), ['too_many']);
  assert.deepEqual(errors(many, FILE_JS), []);
});

// --- 2. one finding shape ---------------------------------------------------

test('a finding names its place twice: once for a log, once for a form', () => {
  const [finding] = walkFieldDefinitions(
    [
      { key: 'title', type: 'string', label: 'Title' },
      {
        key: 'rows',
        type: 'items',
        label: 'Rows',
        itemFields: [
          { key: 'name', type: 'string', label: 'Name' },
          { key: 'kind', type: 'enum', label: 'Kind', options: [] },
        ],
      },
    ],
    DB,
  ).findings;
  assert.equal(finding.code, 'enum_without_options');
  assert.equal(finding.path, 'fields[1].itemFields[1]');
  assert.equal(finding.name, '"Rows" › "Kind"');
  assert.equal(finding.index, 1, 'the top-level row the builder opens');
  assert.equal(finding.itemIndex, 1, 'the sub-row inside it');
  assert.equal(finding.key, 'kind');
  // The place is the caller's to choose; the sentence is not.
  assert.match(describeFieldFinding(finding), /^"Rows" › "Kind" is an enum/);
  assert.match(
    describeFieldFinding(finding, `v.${finding.path}`),
    /^v\.fields\[1\]\.itemFields\[1\] is an enum/,
  );
});

test('nesting deeper than the builder can render still gets walked', () => {
  // `text-blocks-slide` declares `rows[].blocks[]`; the boot-time check used to
  // stop one level down, so nothing below it was ever validated.
  const { findings } = walkFieldDefinitions(
    [
      {
        key: 'rows',
        type: 'items',
        label: 'Rows',
        itemFields: [
          {
            key: 'blocks',
            type: 'items',
            label: 'Blocks',
            itemFields: [{ key: 'body', type: 'nope', label: 'Body' }],
          },
        ],
      },
    ],
    FILE_JS,
  );
  assert.deepEqual(
    findings.map((f) => f.code),
    ['unknown_type'],
  );
  assert.equal(findings[0].path, 'fields[0].itemFields[0].itemFields[0]');
  assert.equal(findings[0].name, '"Rows" › "Blocks" › "Body"');
  // Coordinates saturate at the two levels the builder renders.
  assert.equal(findings[0].index, 0);
  assert.equal(findings[0].itemIndex, 0);
});

test('a sentence for a form opens in upper case, whatever names the place', () => {
  // The human name of the array itself, and of a field with neither label nor
  // key, opens in lower case (`the field list`, `field 3`). The API answers
  // with the sentence as-is, so it has to start like one. A log line keeps the
  // caller's own prefix untouched.
  const [list] = walkFieldDefinitions({}, DB).findings;
  assert.equal(describeFieldFinding(list), 'The field list must be an array.');
  assert.equal(
    describeFieldFinding(list, 'v.fields'),
    'v.fields must be an array.',
  );
  const [nameless] = walkFieldDefinitions([{ type: 'string' }], DB).findings;
  assert.equal(describeFieldFinding(nameless), 'Field 1 has no key.');
});

test('every code the walk emits has a sentence', () => {
  const seen = new Set();
  const collect = (fields, profile, options) => {
    for (const f of walkFieldDefinitions(fields, { ...profile, ...options })
      .findings) {
      seen.add(f.code);
      assert.notEqual(
        describeFieldFinding(f),
        'Invalid field definitions.',
        `no sentence for ${f.code}`,
      );
    }
  };
  for (const [, fields] of SHARED_RULES) collect(fields, DB);
  collect([{ key: 'n', type: 'number', label: 'N' }], DB);
  collect([{ key: 'a', type: 'string' }], DB);
  collect([{ key: 'slideBgImage', type: 'image', label: 'Bg' }], {
    ...FILE_JS,
    globalFieldKeys: ['slideBgImage'],
  });
  collect(
    [
      { key: 'a', type: 'image', label: 'A', mediaRef: 'yes' },
      { key: 'b', type: 'image', label: 'B', mediaRef: { label: 'X' } },
      { key: 'c', type: 'string', label: 'C', mediaRef: {} },
      {
        key: 'd',
        type: 'string',
        label: 'D',
        mediaRef: { label: 'X', linkKey: 'nope' },
      },
      { key: 'e', type: 'string', label: 'E', foldUnofferedTo: 'x' },
      {
        key: 'f',
        type: 'enum',
        label: 'F',
        options: ['a'],
        foldUnofferedTo: 'b',
      },
      {
        key: 'g',
        type: 'items',
        label: 'G',
        itemFields: [{ key: 'h', type: 'string', label: 'H' }],
        itemLabelField: 'nope',
      },
    ],
    FILE_JS,
  );
  collect(
    Array.from({ length: MAX_CUSTOM_TYPE_FIELDS + 1 }, (_, i) => ({
      key: `f${i}`,
      type: 'string',
      label: `F${i}`,
    })),
    DB,
  );
  // A code with no case here is a message nobody has read.
  assert.ok(seen.size >= 15, `only ${seen.size} codes exercised`);
});

// --- 3. the A2.1–A2.3 declarations, at every depth --------------------------

test('a declaration is checked beside the field that declares it, and only warns', () => {
  const { findings } = walkFieldDefinitions(
    [
      { key: 'watchUrl', type: 'string', label: 'Watch' },
      {
        key: 'source',
        type: 'string',
        label: 'Source',
        mediaRef: { label: 'Video', linkKey: 'watchUrl' },
      },
      {
        key: 'density',
        type: 'enum',
        label: 'Density',
        options: ['auto', 'compact'],
        foldUnofferedTo: 'auto',
      },
      {
        key: 'cards',
        type: 'items',
        label: 'Cards',
        itemLabelField: 'title',
        itemFields: [{ key: 'title', type: 'string', label: 'Title' }],
      },
    ],
    FILE_JS,
  );
  assert.deepEqual(findings, [], 'a well-formed declaration says nothing');
});

test('a mediaRef linkKey resolves against the level it sits on', () => {
  // Inside an items field, a sibling sub-field — not a top-level key.
  const fields = [
    { key: 'watchUrl', type: 'string', label: 'Watch' },
    {
      key: 'clips',
      type: 'items',
      label: 'Clips',
      itemFields: [
        { key: 'link', type: 'string', label: 'Link' },
        {
          key: 'src',
          type: 'string',
          label: 'Src',
          mediaRef: { label: 'Video', linkKey: 'link' },
        },
      ],
    },
  ];
  assert.deepEqual(codes(fields, FILE_JS), []);
  fields[1].itemFields[1].mediaRef.linkKey = 'watchUrl';
  assert.deepEqual(codes(fields, FILE_JS), ['media_ref_link_key_unknown']);
});

test('a global field key is a valid link target and a shadow at the same time', () => {
  const profile = { ...FILE_JS, globalFieldKeys: ['slideBgImage'] };
  assert.deepEqual(
    codes(
      [
        {
          key: 'src',
          type: 'string',
          label: 'Src',
          mediaRef: { label: 'V', linkKey: 'slideBgImage' },
        },
      ],
      profile,
    ),
    [],
  );
  assert.deepEqual(
    codes([{ key: 'slideBgImage', type: 'image', label: 'Bg' }], profile),
    ['shadows_global'],
  );
});

// --- 4. what each caller does with the findings -----------------------------

test('the builder answers with the first error', () => {
  const bad = validateCustomFieldDefinitions([
    { key: 'a', type: 'string', label: 'A' },
    { key: 'b', type: 'enum', label: 'B', options: [] },
    { key: 'b', type: 'string', label: 'C' },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.problem.code, 'enum_without_options', 'the first error');

  const good = validateCustomFieldDefinitions([
    {
      key: 'rows',
      type: 'items',
      label: 'Rows',
      minItems: 1,
      itemFields: [{ key: 'title', type: 'string', label: 'T' }],
    },
  ]);
  assert.equal(good.ok, true);
  assert.deepEqual(good.fields, [
    {
      key: 'rows',
      type: 'items',
      label: 'Rows',
      itemFields: [{ key: 'title', type: 'string', label: 'T' }],
      minItems: 1,
    },
  ]);
});

// --- 5. the stored vocabulary is a contract, not a filter (D84) -------------

/**
 * A property the DB surface has no control for used to fall out on the way to
 * storage: the definition was accepted, and the declaration was gone by the
 * time anyone looked. That silent drop is why the A2 declarations could not
 * reach a DB type at all. The vocabulary now refuses what it does not know,
 * located on the row that declares it — and the boot surface, whose source is
 * hand-written, stays open.
 */
test('a property outside the stored vocabulary is refused, and located', () => {
  const result = validateCustomFieldDefinitions([
    { key: 'a', type: 'string', label: 'A' },
    { key: 'b', type: 'string', label: 'B', presetSource: 'themeColors' },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.problem.code, 'unknown_property');
  assert.equal(result.problem.severity, 'error');
  assert.equal(result.problem.detail.property, 'presetSource');
  assert.equal(result.problem.index, 1, 'the row the builder must open');
  assert.equal(result.problem.itemIndex, null);
  assert.match(describeFieldFinding(result.problem), /"B"/);

  assert.deepEqual(
    codes(
      [{ key: 'b', type: 'string', label: 'B', presetSource: 'x' }],
      FILE_JS,
    ),
    [],
    'hand-written source declares more than a form can, and stays open',
  );
});

test('the vocabulary is read per field type', () => {
  const onTheWrongRow = validateCustomFieldDefinitions([
    { key: 'a', type: 'string', label: 'A', options: ['x'] },
  ]);
  assert.equal(onTheWrongRow.ok, false);
  assert.equal(onTheWrongRow.problem.code, 'unknown_property');
  assert.equal(onTheWrongRow.problem.detail.property, 'options');

  const onTheRightRow = validateCustomFieldDefinitions([
    { key: 'a', type: 'enum', label: 'A', options: ['x'] },
  ]);
  assert.equal(onTheRightRow.ok, true);
});

test('a `mediaRef` that is not an object is refused where the vocabulary is closed', () => {
  // Open source ignores it (a warning); the stored row would otherwise be
  // rewritten into an empty declaration — a choice `cleanField` no longer makes.
  const fields = [{ key: 'a', type: 'string', label: 'A', mediaRef: 'Video' }];
  assert.deepEqual(codes(fields, FILE_JS), ['media_ref_not_an_object']);
  assert.equal(
    walkFieldDefinitions(fields, FILE_JS).findings[0].severity,
    'warning',
  );
  const result = validateCustomFieldDefinitions(fields);
  assert.equal(result.ok, false);
  assert.equal(result.problem.code, 'media_ref_not_an_object');
  assert.match(describeFieldFinding(result.problem), /cannot carry/);
});

test('a property nested inside `mediaRef` is read the same way', () => {
  const result = validateCustomFieldDefinitions([
    {
      key: 'a',
      type: 'string',
      label: 'A',
      mediaRef: { label: 'V', href: 'x' },
    },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.problem.code, 'unknown_property');
  assert.equal(result.problem.detail.property, 'mediaRef.href');
});

test('a key whose value is undefined declares nothing, on either side of JSON', () => {
  // JSON cannot carry `undefined`, so the API never sees such a key, while
  // `structuredClone` keeps it on the client. Refusing it would let the client
  // refuse what the server accepts — the drift this walk exists to end.
  const field = { key: 'a', type: 'enum', label: 'A', options: ['x'] };
  field.maxLength = undefined;
  assert.equal(validateCustomFieldDefinitions([field]).ok, true);
});

test('a stored row carries the three A2 declarations, unchanged', () => {
  const result = validateCustomFieldDefinitions([
    {
      key: 'src',
      type: 'string',
      label: 'Source',
      mediaRef: { label: ' Video ', linkKey: 'watchUrl' },
    },
    { key: 'watchUrl', type: 'string', label: 'Watch URL' },
    {
      key: 'density',
      type: 'enum',
      label: 'Density',
      options: ['auto', 'compact'],
      foldUnofferedTo: 'auto',
    },
    {
      key: 'rows',
      type: 'items',
      label: 'Rows',
      itemLabelField: 'title',
      itemFields: [
        { key: 'value', type: 'string', label: 'Value' },
        { key: 'title', type: 'string', label: 'Title' },
      ],
    },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields[0].mediaRef, {
    label: 'Video',
    linkKey: 'watchUrl',
  });
  assert.equal(result.fields[2].foldUnofferedTo, 'auto');
  assert.equal(result.fields[3].itemLabelField, 'title');

  // A second pass over the stored form is a no-op: what the builder reads back
  // and posts again is what it posted.
  const again = validateCustomFieldDefinitions(result.fields);
  assert.equal(again.ok, true);
  assert.deepEqual(again.fields, result.fields);
});

test('an inert A2 declaration is a warning, not a refusal', () => {
  // Same contract as `foldUnofferedTo` on a non-enum and `mediaRef` on a
  // non-string: the row is storable, the declaration does nothing, and the boot
  // report says so.
  const fields = [
    {
      key: 'a',
      type: 'items',
      label: 'A',
      itemLabelField: 'x',
      itemFields: [],
    },
  ];
  assert.deepEqual(
    codes(
      [{ key: 'a', type: 'string', label: 'A', itemLabelField: 'x' }],
      FILE_JS,
    ),
    ['item_label_field_not_items'],
  );
  assert.equal(
    walkFieldDefinitions(fields, FILE_JS).findings.some(
      (f) => f.code === 'item_label_field_not_items',
    ),
    false,
    'an items field with an unresolvable heading is the other finding',
  );
});

test('the boot report renders every finding, errors and warnings apart', () => {
  const report = validateSlideTypeDefinition(
    {
      label: 'Fixture',
      renderHtml: () => '<div class="slide-fixture"></div>',
      fields: [
        { key: 'a', type: 'nope', label: 'A' },
        { key: 'b', type: 'string' },
      ],
    },
    'fixture-slide',
  );
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /^fixture-slide\.fields\[0\] \(a\)/);
  assert.ok(
    report.warnings.some((w) => /fixture-slide\.fields\[1\] \(b\)/.test(w)),
    `missing label warning, got:\n${report.warnings.join('\n')}`,
  );
});
