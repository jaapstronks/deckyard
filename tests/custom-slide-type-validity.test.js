/**
 * The definition validator — gap 1a of `briefs/forker-slide-type-toolkit.md`.
 *
 * `validateSlide()` checks a slide's CONTENT against a type's `fields[]`.
 * Nothing checked the `fields[]` themselves, so a fork could ship a typo'd
 * `field.type`, an `enum` with no options or a missing `renderHtml`, watch the
 * type load cleanly, and meet the failure per slide at render time. These tests
 * are the guard that keeps that closed:
 *
 *  1. the **tracked fork fixtures** (the file-JS reference types this repo has
 *     — `custom/slide-types/` is gitignored, so they are the only committed
 *     examples) validate clean;
 *  2. every **core** definition validates without errors, so a core type can no
 *     longer regress into a shape a fork would be refused for;
 *  3. a table of **malformed** definitions each produces the error it should;
 *  4. every core type carries its canonical `.slide-<name>` root — the class a
 *     fork's stylesheet nests under — bar two recorded legacies.
 *
 * Run with: node --test tests/custom-slide-type-validity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CORE_SLIDE_TYPE_DEFS,
  GLOBAL_SLIDE_FIELD_KEYS,
  CORE_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import {
  formatDefinitionReport,
  slideRootClass,
  validateSlideTypeDefinition,
} from '../shared/slide-types/validate-definition.js';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TESTS_DIR, '..');
const FIXTURE_DIR = join(TESTS_DIR, 'fixtures', 'fork-slide-types');

/**
 * Import the fixtures the way the `test-fork` CI job installs them: from a
 * directory two levels below the repo root.
 *
 * They cannot be imported in place. A fork type's `import` specifiers are
 * written for its RUNTIME home (`custom/slide-types/`, hence `../../shared/…`),
 * and `payoff-slide.js` carries one on purpose — it is what
 * `tests/custom-imports-resolvable.test.js` exercises. Importing from
 * `tests/fixtures/` would resolve that to `tests/shared/…` and throw. Copying
 * to `<root>/<tmp>/slide-types/` restores the depth, so all three fixtures load
 * exactly as they do in the fork lane.
 *
 * @returns {Promise<Array<{file: string, name: string, def: unknown}>>}
 */
async function loadFixtures() {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.js'));
  const tmp = mkdtempSync(join(REPO_ROOT, '.fork-fixtures-'));
  try {
    const dir = join(tmp, 'slide-types');
    mkdirSync(dir);
    const loaded = [];
    for (const file of files) {
      copyFileSync(join(FIXTURE_DIR, file), join(dir, file));
      const mod = await import(pathToFileURL(join(dir, file)).href);
      loaded.push({ file, name: file.replace(/\.js$/, ''), def: mod.default });
    }
    return loaded;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** A minimal definition that must always validate clean. */
function validDef(extra = {}) {
  return {
    label: 'Fixture',
    fields: [{ key: 'heading', type: 'string', label: 'Heading' }],
    defaults: { heading: '' },
    renderHtml: () => '<div class="slide slide-fixture"></div>',
    ...extra,
  };
}

test('every tracked fork fixture validates clean', async () => {
  const fixtures = await loadFixtures();
  assert.ok(fixtures.length >= 3, 'the fork fixture tree must not be empty');

  for (const { file, name, def } of fixtures) {
    const report = validateSlideTypeDefinition(def, name, {
      globalFieldKeys: GLOBAL_SLIDE_FIELD_KEYS,
    });
    assert.deepEqual(
      report.errors,
      [],
      `${file} must have no definition errors`,
    );
    assert.deepEqual(
      report.warnings,
      [],
      `${file} must have no definition warnings`,
    );
  }
});

test('every core slide type validates without errors', () => {
  const offenders = [];
  for (const [name, def] of Object.entries(CORE_SLIDE_TYPE_DEFS)) {
    // No `globalFieldKeys` here on purpose: these definitions are COMPOSED,
    // so they legitimately carry the injected a11y/background fields, and the
    // shadowing warning would fire for every one of them. The loader validates
    // raw definitions, where the warning means what it says.
    const report = validateSlideTypeDefinition(def, name);
    if (report.errors.length) offenders.push(...report.errors);
  }
  assert.deepEqual(offenders, []);
});

/**
 * The two core types whose root class predates the convention. Both are class
 * *contract* changes (`docs/reference/slide-type-css-contract.md`), so they
 * belong in a release with notes, not in the commit that documented the rule —
 * they are recorded here instead so the drift cannot grow quietly.
 *
 * Two-way honest, like the `UNSTYLED` table in the CSS-contract test: the sweep
 * below fails when a type not listed here starts violating the convention, AND
 * when a listed one is fixed and the entry is left behind.
 */
const ROOT_CLASS_LEGACIES = {
  'title-slide':
    'renamed to `.slide-title-universal` in v1.8.0 (the rename that made the ' +
    'class contract a gate in the first place)',
  'list-slide':
    'renders `.slide-lijstje`, the Dutch name it was born with; see ' +
    'tests/lijstje-slide-migration.test.js',
};

test('every core slide type carries its canonical root class', () => {
  const offenders = [];
  const fixed = [];
  for (const [name, def] of Object.entries(CORE_SLIDE_TYPE_DEFS)) {
    const warned = validateSlideTypeDefinition(def, name).warnings.some((w) =>
      w.includes('does not carry'),
    );
    const known = Object.hasOwn(ROOT_CLASS_LEGACIES, name);
    if (warned && !known)
      offenders.push(`${name} (want ${slideRootClass(name)})`);
    if (!warned && known) fixed.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    'a core type must render `.slide-<canonical name>` as its root class — ' +
      'that is the rule custom types are warned against',
  );
  assert.deepEqual(
    fixed,
    [],
    'these types now comply: drop them from ROOT_CLASS_LEGACIES',
  );
});

test('a well-formed definition reports nothing', () => {
  const report = validateSlideTypeDefinition(validDef(), 'fixture-slide', {
    globalFieldKeys: GLOBAL_SLIDE_FIELD_KEYS,
  });
  assert.deepEqual(report, { errors: [], warnings: [] });
  assert.deepEqual(formatDefinitionReport(report), []);
});

/**
 * The malformed table. Each row is a definition that MUST error, plus a
 * fragment the message has to contain — so the test fails both when a shape
 * stops being caught and when it is caught for the wrong reason.
 */
const MALFORMED = [
  ['not an object', 'nope', 'default export'],
  ['no label', validDef({ label: '' }), '`label`'],
  ['label is not a string', validDef({ label: 42 }), '`label`'],
  [
    'renderHtml missing',
    { label: 'X', fields: [], defaults: {} },
    '`renderHtml`',
  ],
  [
    'renderHtml is a string',
    validDef({ renderHtml: '<div></div>' }),
    '`renderHtml`',
  ],
  [
    'fields is not an array',
    validDef({ fields: {} }),
    '`fields` must be an array',
  ],
  [
    'field without a key',
    validDef({ fields: [{ type: 'string' }] }),
    'key must be a non-empty string',
  ],
  [
    'duplicate field keys',
    validDef({
      fields: [
        { key: 'a', type: 'string' },
        { key: 'a', type: 'markdown' },
      ],
    }),
    'duplicate field key',
  ],
  [
    'unknown field type',
    validDef({ fields: [{ key: 'a', type: 'strng' }] }),
    'is not a declared field type',
  ],
  [
    'enum without options',
    validDef({ fields: [{ key: 'tone', type: 'enum' }] }),
    'enum with no usable options',
  ],
  [
    'enum whose options are all malformed',
    validDef({
      fields: [{ key: 'tone', type: 'enum', options: [{ label: 'A' }] }],
    }),
    'enum with no usable options',
  ],
  [
    'items without itemFields',
    validDef({ fields: [{ key: 'rows', type: 'items' }] }),
    'without an `itemFields` array',
  ],
  [
    'item field with an unknown type',
    validDef({
      fields: [
        { key: 'rows', type: 'items', itemFields: [{ key: 'a', type: 'txt' }] },
      ],
    }),
    'is not a declared field type',
  ],
  [
    'duplicate item field keys',
    validDef({
      fields: [
        {
          key: 'rows',
          type: 'items',
          itemFields: [
            { key: 'a', type: 'string' },
            { key: 'a', type: 'string' },
          ],
        },
      ],
    }),
    'duplicate item field key',
  ],
  [
    'function inside inline',
    validDef({
      inline: { cards: { field: 'heading', addPlacement: () => 'x' } },
    }),
    'travels to the client as JSON',
  ],
  [
    'inline.formText naming nothing',
    validDef({ inline: { formText: ['heading', 'ghost'] } }),
    'inline.formText[1]',
  ],
  [
    'inline.cards naming nothing',
    validDef({ inline: { cards: { field: 'rows' } } }),
    '`inline.cards.field`',
  ],
  [
    'inline.cards pointing at a non-items field',
    validDef({ inline: { cards: { field: 'heading' } } }),
    'is not an `items` field',
  ],
  [
    'inline.cards.child naming a top-level key',
    validDef({
      fields: [
        { key: 'heading', type: 'string' },
        {
          key: 'rows',
          type: 'items',
          itemFields: [{ key: 'title', type: 'string' }],
        },
      ],
      inline: { cards: { field: 'rows', child: { field: 'heading' } } },
    }),
    'not an item field of `rows`',
  ],
];

for (const [why, def, fragment] of MALFORMED) {
  test(`rejects: ${why}`, () => {
    const report = validateSlideTypeDefinition(def, 'fixture-slide');
    assert.ok(
      report.errors.length > 0,
      `expected at least one error for "${why}"`,
    );
    assert.ok(
      report.errors.some((e) => e.includes(fragment)),
      `expected an error containing ${JSON.stringify(fragment)}, got:\n` +
        report.errors.join('\n'),
    );
  });
}

/**
 * The warning table: shapes that leave the type renderable but silently drop
 * something the author wrote. They must NOT block registration.
 */
const WARNING_CASES = [
  [
    'a field shadowing a global one',
    validDef({
      fields: [{ key: 'slideBgImage', type: 'image' }],
      defaults: {},
    }),
    'shadows the global slide field',
    { globalFieldKeys: GLOBAL_SLIDE_FIELD_KEYS },
  ],
  [
    'an invalid namespace',
    validDef({ namespace: 'Not A Namespace' }),
    'falls back to `custom`',
    {},
  ],
  [
    'an unknown ai.category',
    validDef({ ai: { description: 'x', category: 'sparkly' } }),
    '`ai.category`',
    {},
  ],
  [
    'an ai block without a description',
    validDef({ ai: {} }),
    '`description`',
    {},
  ],
  [
    'an ai.schema block',
    validDef({ ai: { description: 'x', schema: {} } }),
    '`ai.schema` is ignored',
    {},
  ],
  [
    'a default for a field that does not exist',
    validDef({ defaults: { heading: '', ghost: 1 } }),
    'has no field `ghost`',
    {},
  ],
  [
    // Not an error: editor-utils and semantic-projection both fall back to the
    // heuristic outline-label resolvers, so the type renders untouched.
    'a labelField naming nothing',
    validDef({ labelField: 'nope' }),
    'falls back to the built-in resolvers',
    {},
  ],
  [
    // The CSS-scoping convention: the root class is the only handle a fork's
    // `custom/styles/*.css` has to nest under. A warning, not an error —
    // a type that ships no CSS at all is a legitimate shape.
    'a rendered root without the canonical class',
    validDef({ renderHtml: () => '<div class="slide hero"></div>' }),
    'does not carry `slide-fixture`',
    {},
  ],
  [
    'a required field with no default',
    validDef({
      fields: [{ key: 'heading', type: 'string', required: true }],
      defaults: {},
    }),
    'has no entry in `defaults`',
    {},
  ],
];

for (const [why, def, fragment, options] of WARNING_CASES) {
  test(`warns (but accepts): ${why}`, () => {
    const report = validateSlideTypeDefinition(def, 'fixture-slide', options);
    assert.deepEqual(report.errors, [], 'a warning must not block the type');
    assert.ok(
      report.warnings.some((w) => w.includes(fragment)),
      `expected a warning containing ${JSON.stringify(fragment)}, got:\n` +
        report.warnings.join('\n'),
    );
  });
}

test('`ai: false` is the supported opt-out, not a malformed ai block', () => {
  const report = validateSlideTypeDefinition(
    validDef({ ai: false }),
    'fixture-slide',
  );
  assert.deepEqual(report, { errors: [], warnings: [] });
});

test('coreNames flags a name the registry would refuse', () => {
  const name = CORE_SLIDE_TYPE_NAMES[0];
  // Rendered under a core name, so its root has to wear that name's class or
  // the scoping warning fires alongside the one under test.
  const root = `<div class="slide ${slideRootClass(name)}"></div>`;
  const shadow = validateSlideTypeDefinition(
    validDef({ renderHtml: () => root }),
    name,
    { coreNames: CORE_SLIDE_TYPE_NAMES },
  );
  assert.deepEqual(shadow.errors, []);
  assert.ok(shadow.warnings.some((w) => w.includes('override: true')));

  const deliberate = validateSlideTypeDefinition(
    validDef({ override: true, renderHtml: () => root }),
    name,
    { coreNames: CORE_SLIDE_TYPE_NAMES },
  );
  assert.deepEqual(deliberate.warnings, []);
});

test('formatDefinitionReport labels errors and warnings', () => {
  const lines = formatDefinitionReport({
    errors: ['boom'],
    warnings: ['careful'],
  });
  assert.deepEqual(lines, ['  ERROR    boom', '  WARNING  careful']);
});
