/**
 * Every class a slide type renders must resolve to a CSS rule.
 *
 * This is the missing half of a pair. `scripts/lint-dead-css.js` walks the
 * other way — CSS selectors nothing references — and is advisory. This one is a
 * gate, because the failure it catches is the one that reached production.
 *
 * What happened: v1.8.0 replaced the title slide's class contract
 * (`.slide-title`, `.title-bar`, `.title-text`, `.title-logo`, `.logo-mark`,
 * `.logo-img`, `.subtitle` became `.slide-title-universal` plus the `tsu-*`
 * family; the root class has since returned to `.slide-title`, the convention
 * name). Only the new names carried CSS. A fork's own title slide emitted the
 * old ones and fell back to bare document flow — a full-bleed title slide became
 * an inline image with the heading under it. Nothing broke that CI or an agent
 * watches: no import failed, the HTML was valid, 2151 tests were green, the site
 * returned 200. A human found it hours after deploy.
 *
 * So the class names a slide type emits are a **public contract**, and this test
 * is what makes that statement checkable. It also protects upstream from its own
 * dead classes, which is how the thirteen entries in {@link UNSTYLED} got found.
 *
 * **It sweeps both halves of the registry, each against its own definitions.**
 * The core types render from `CORE_SLIDE_TYPE_DEFS`, so an installed override
 * never hides a core class that moved. The types a fork adds or overrides
 * (`CUSTOM_SLIDE_TYPE_NAMES`) render from `SLIDE_TYPES`, the definition that
 * actually runs. Both are held against one corpus: `client/styles/**` plus the
 * fork's `custom/styles/**`, which loads last in every render path. That corpus
 * is what lets the gate see a fork without a fork allowlist: the fork's classes
 * are styled by the fork's own stylesheets, and those are in the corpus. In
 * upstream's own `test` job `custom/` is empty and the fork half sweeps
 * nothing; the `test-fork` job loads three fixture types plus their stylesheet
 * and runs it for real.
 *
 * See `docs/reference/slide-type-css-contract.md`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORE_SLIDE_TYPE_DEFS,
  CORE_SLIDE_TYPE_NAMES,
  CUSTOM_SLIDE_TYPE_NAMES,
  SLIDE_TYPES,
} from '../shared/slide-types/registry.js';
import { customDirFor } from '../shared/custom-root.js';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { resolveItemDefaults } from '../shared/slide-types/item-defaults.js';
import { extractCssClasses } from '../scripts/lint-dead-css.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
/**
 * Where a rule may live: core's stylesheets and the fork seam. Pinned by a test
 * below, because dropping the second entry would turn the fork half back into
 * an assertion no fork can pass.
 */
const CSS_CORPUS = [
  path.join(REPO_ROOT, 'client', 'styles'),
  path.join(customDirFor(REPO_ROOT), 'styles'),
];

/**
 * Classes a type emits that have no CSS rule, and are allowed not to have one.
 *
 * Every entry carries a reason, and the second test below fails if an entry
 * stops being emitted — so this cannot become a junk drawer of names nothing
 * renders any more. The two categories are different in kind:
 *
 * `hook` — the class exists so code can find the element. It is queried by a
 * selector somewhere and styling it would be beside the point.
 *
 * `unstyled` — the class is emitted and no *dedicated* rule targets it, yet its
 * presence is not junk: it is either the default value of an enum whose base
 * slide already styles it (only the non-default siblings carry a rule), or a
 * name whose look comes from an inline style or a numbered variant beside it.
 * Removing one is a contract change under the rule this test enforces (a fork
 * may style it), so it belongs in release notes, not a drive-by commit. The
 * seven genuinely-dead names that once lived here — emitted, styled nowhere,
 * carrying no such reason — were removed at source; see the release notes.
 *
 * @type {Record<string, { kind: 'hook' | 'unstyled', why: string }>}
 */
const UNSTYLED = {
  'chart-frag': {
    kind: 'hook',
    why: 'presenter stepping queries it — client/views/presenter/step.js:179',
  },
  'team-cards-group-right': {
    kind: 'hook',
    why: 'inline-edit anchor selector — shared/slide-types/types/team-cards-slide/inline-edit.js:19',
  },

  'chart-slice': {
    kind: 'unstyled',
    why: 'pie renderer emits it beside the styled `chart-slice-<n>`; the base name carries no rule',
  },
  'is-left': {
    kind: 'unstyled',
    why: 'image-text marks the default side; only the opposite (`.split.is-right`) has rules',
  },
  'slide-bg-custom': {
    kind: 'unstyled',
    why: 'the `custom` background takes its colour from an inline style, so there is nothing to declare',
  },
  'aspect-square': {
    kind: 'unstyled',
    why: 'team-cards: the default `imageAspect`; only the non-default `.aspect-original` carries rules, so the base slide styles this value',
  },
  'shape-rounded': {
    kind: 'unstyled',
    why: 'team-cards: the default `imageShape`; only `.shape-square`/`.shape-circle` carry rules, so the base slide styles this value',
  },
  'is-layout-center': {
    kind: 'unstyled',
    why: 'chapter-title: the default `layout`; only `.is-layout-top`/`.is-layout-bottom` carry rules, so the base slide styles this value',
  },
};

/**
 * Every `.css` file under `dir`, absolute; none when the directory is absent
 * (a checkout without `custom/styles/`).
 * @param {string} dir
 * @returns {string[]}
 */
function cssFilesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFilesUnder(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/**
 * Class names that have at least one rule in the corpus.
 * @param {string[]} [roots]
 * @returns {Set<string>}
 */
function definedClasses(roots = CSS_CORPUS) {
  const out = new Set();
  for (const file of roots.flatMap(cssFilesUnder)) {
    for (const rec of extractCssClasses(fs.readFileSync(file, 'utf8'), file))
      out.add(rec.name);
  }
  return out;
}

/**
 * The values worth rendering a single scalar field with.
 *
 * Two kinds of field carry a modifier class: an `enum` (one class per declared
 * option) and a `boolean` (a class on one of the two states — `bleed` on
 * image-slide emits `is-bleed` only when true, and a sweep that never sets it
 * would call that class unrendered).
 *
 * @param {object} field
 * @returns {unknown[]}
 */
function fieldValueVariants(field) {
  if (field.type === 'boolean') return [true, false];
  const options = Array.isArray(field.options) ? field.options : null;
  if (!options) return [];
  const out = [];
  for (const option of options) {
    const value =
      option && typeof option === 'object'
        ? (option.value ?? option.id ?? option.key)
        : option;
    if (value === undefined) continue;
    out.push(value);
  }
  return out;
}

/**
 * Variant arrays for an `items` field: the field's own value, with one item
 * carrying one swept value of one of its `itemFields`.
 *
 * Per-item enums are a real source of modifier classes — `rows[].color` on
 * text-blocks emits `is-black`, `images[].fit` on image-text emits
 * `is-fit-contain` — and they live one level below `def.fields`, so a sweep
 * that only walks the top level never reaches them. The mutation lands on the
 * first item of whatever the defaults already hold; a type whose defaults carry
 * no items gets the field's declared new-item skeleton instead, so the array
 * shape is the one the editor would have produced.
 *
 * @param {object} field - a field declaring `itemFields`
 * @param {unknown} current - the value the defaults hold for it, if any
 * @returns {unknown[][]}
 */
function itemsValueVariants(field, current) {
  const seed =
    Array.isArray(current) && current.length
      ? current
      : [resolveItemDefaults(field, 'nl')];
  const out = [];
  for (const itemField of field.itemFields || []) {
    for (const value of fieldValueVariants(itemField)) {
      const items = structuredClone(seed);
      items[0] = { ...items[0], [itemField.key]: value };
      out.push(items);
    }
    if (Array.isArray(itemField.itemFields)) {
      for (const nested of itemsValueVariants(
        itemField,
        seed[0]?.[itemField.key],
      )) {
        const items = structuredClone(seed);
        items[0] = { ...items[0], [itemField.key]: nested };
        out.push(items);
      }
    }
  }
  return out;
}

/**
 * The content objects to render a type with: its defaults, plus one variant per
 * declared option of every enum field, both states of every boolean field, and
 * the same for the fields of a collection field's items (recursively).
 *
 * Rendering defaults alone misses the whole `is-*` family — the layout,
 * alignment and background modifiers that only appear on a non-default value,
 * and those are exactly the names a restyle renames. Enumerating those values
 * costs 777 renders across the registry.
 *
 * The two extensions beyond the top-level enums each buy something concrete.
 * Booleans: `is-bleed` was reached only through image-slide's *legacy* hidden
 * `layout` enum, so retiring that compatibility field would have silently
 * dropped the class out of the sweep; the `bleed` toggle now covers it on the
 * canonical path. Item fields: `is-black` (text-blocks `rows[].color`) was not
 * reached at all, and `is-fit-contain` is now attributed to image-text through
 * its own `images[].fit` rather than borrowed from image-slide.
 *
 * @param {object} def
 * @returns {object[]}
 */
function contentVariants(def) {
  const base = structuredClone(def.defaults || {});
  const out = [base];
  for (const field of def.fields || []) {
    for (const value of fieldValueVariants(field)) {
      out.push({ ...base, [field.key]: value });
    }
    if (Array.isArray(field.itemFields)) {
      for (const items of itemsValueVariants(field, base[field.key])) {
        out.push({ ...base, [field.key]: items });
      }
    }
  }
  return out;
}

/**
 * Class names appearing in `class="…"`. A type's rules live in a stylesheet,
 * never in an inline `<style>` (the definition validator refuses one), so the
 * markup's classes are the whole of what it asks the corpus for.
 * @param {string} html
 * @returns {Set<string>}
 */
function classesIn(html) {
  const emitted = new Set();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const name of match[1].split(/\s+/)) if (name) emitted.add(name);
  }
  return emitted;
}

/**
 * Render every content variant of `names` against `defs` and collect what they
 * emit.
 * @param {readonly string[]} names
 * @param {Record<string, object>} defs - the definitions to render with
 * @returns {{ emitted: Map<string, Set<string>> }} class name → the types
 *   that emit it
 */
function sweep(names, defs) {
  const emitted = new Map();
  for (const type of names) {
    for (const content of contentVariants(defs[type])) {
      let html;
      try {
        html = renderSlideHtml(
          { type, content },
          { lang: 'nl', slideTypes: defs },
        );
      } catch {
        // A variant a type rejects is not this test's business; the defaults
        // render is asserted separately below.
        continue;
      }
      for (const name of classesIn(html)) {
        if (!emitted.has(name)) emitted.set(name, new Set());
        emitted.get(name).add(type);
      }
    }
  }
  return { emitted };
}

/**
 * The emitted classes with no rule in `defined` and no `UNSTYLED` excuse,
 * sorted.
 * @param {{ emitted: Map<string, Set<string>> }} swept
 * @param {Set<string>} defined
 * @returns {string[]}
 */
function orphansOf(swept, defined) {
  return [...swept.emitted.keys()]
    .filter((name) => !defined.has(name))
    .filter((name) => !Object.hasOwn(UNSTYLED, name))
    .sort();
}

/**
 * The assertion message for a non-empty orphan list.
 * @param {string[]} orphans
 * @param {Map<string, Set<string>>} emitted
 * @param {string} advice - what the author of this half should do
 * @returns {string}
 */
function orphanReport(orphans, emitted, advice) {
  return (
    'these classes are rendered but have no CSS rule anywhere:\n' +
    orphans
      .map((n) => `  .${n}  (from ${[...emitted.get(n)].join(', ')})`)
      .join('\n') +
    '\n\nA class with no rule renders as bare document flow — valid HTML, green ' +
    `tests, wrong page. ${advice}`
  );
}

const CORE = sweep(CORE_SLIDE_TYPE_NAMES, CORE_SLIDE_TYPE_DEFS);
const FORK = sweep(CUSTOM_SLIDE_TYPE_NAMES, SLIDE_TYPES);
const EMITTED = CORE.emitted;

const forkSkip = CUSTOM_SLIDE_TYPE_NAMES.length
  ? false
  : 'no custom slide types loaded — this half runs in the `test-fork` CI job, ' +
    'which copies tests/fixtures/fork-slide-types/ into custom/slide-types/ ' +
    'and tests/fixtures/fork-styles/ into custom/styles/';

test('the scan actually renders the registry', () => {
  // A silently empty render would make the assertion below vacuously true.
  assert.ok(CORE_SLIDE_TYPE_NAMES.length > 20, 'expected a populated registry');
  for (const type of CORE_SLIDE_TYPE_NAMES) {
    const html = renderSlideHtml(
      {
        type,
        content: structuredClone(CORE_SLIDE_TYPE_DEFS[type].defaults || {}),
      },
      { lang: 'nl', slideTypes: CORE_SLIDE_TYPE_DEFS },
    );
    assert.match(html, /class="/, `${type} rendered no classes at all`);
  }
  assert.ok(
    EMITTED.size > 100,
    `expected many emitted classes, got ${EMITTED.size}`,
  );
});

test('every class a slide type emits resolves to a CSS rule', () => {
  const defined = definedClasses();
  assert.ok(
    defined.size > 1000,
    `expected the stylesheets to define many classes, got ${defined.size}`,
  );

  const orphans = orphansOf(CORE, defined);
  assert.deepEqual(
    orphans,
    [],
    orphanReport(
      orphans,
      CORE.emitted,
      'If you renamed a class, rename it in the stylesheet too ' +
        'and put the rename in the release notes (docs/reference/versioning.md ' +
        '§ Renamed slide-type classes). If the class is a selector hook or a known ' +
        'leftover, add it to UNSTYLED in this file with a reason.',
    ),
  );
});

test('the rule corpus is client/styles plus the fork seam custom/styles', () => {
  // The seam goes through customDirFor(), so a fork that moves its root with
  // DECKYARD_CUSTOM_DIR is swept against its own styles, not a stale path.
  assert.deepEqual(CSS_CORPUS, [
    path.join(REPO_ROOT, 'client', 'styles'),
    path.join(customDirFor(REPO_ROOT), 'styles'),
  ]);
});

test(
  'every class a fork slide type emits resolves to a CSS rule',
  { skip: forkSkip },
  () => {
    for (const type of CUSTOM_SLIDE_TYPE_NAMES) {
      assert.ok(
        [...FORK.emitted.values()].some((types) => types.has(type)),
        `${type} rendered no classes at all`,
      );
    }
    const orphans = orphansOf(FORK, definedClasses());
    assert.deepEqual(
      orphans,
      [],
      orphanReport(
        orphans,
        FORK.emitted,
        'Style it in custom/styles/ (the fork seam, loaded last in every render ' +
          'path) or stop emitting it. If a core class your type borrows moved, ' +
          'the release notes name the new one.',
      ),
    );
  },
);

test('a fork type emitting an unstyled class fails the gate', () => {
  // The fork half is only as good as its failure mode, and in upstream's own
  // job it sweeps nothing. This synthetic type proves the same sweep and the
  // same corpus turn an unstyled fork class into an orphan, and a rule in a
  // custom/styles/ file clears it.
  const type = 'probe-fork-slide';
  const defs = {
    [type]: {
      label: 'Probe',
      fields: [],
      defaults: {},
      renderHtml: () =>
        '<div class="slide slide-probe-fork"><p class="probe-fork-unstyled"></p></div>',
    },
  };
  const swept = sweep([type], defs);
  const coreOnly = definedClasses([CSS_CORPUS[0]]);
  assert.deepEqual(orphansOf(swept, coreOnly), [
    'probe-fork-unstyled',
    'slide-probe-fork',
  ]);

  const forkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'css-contract-'));
  try {
    const stylesDir = path.join(forkRoot, 'custom', 'styles');
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.writeFileSync(
      path.join(stylesDir, '10-probe.css'),
      '.slide-probe-fork .probe-fork-unstyled { color: inherit; }\n',
    );
    assert.deepEqual(
      orphansOf(swept, definedClasses([CSS_CORPUS[0], stylesDir])),
      [],
      'a rule in custom/styles/ must clear the fork class',
    );
  } finally {
    fs.rmSync(forkRoot, { recursive: true, force: true });
  }
});

test('no UNSTYLED entry outlives the class it excuses', () => {
  const stale = Object.keys(UNSTYLED)
    .filter((name) => !EMITTED.has(name))
    .sort();
  assert.deepEqual(
    stale,
    [],
    'these UNSTYLED entries name classes no slide type renders any more — ' +
      `delete them:\n${stale.map((n) => `  ${n}`).join('\n')}`,
  );
});

test('no UNSTYLED entry quietly gained a stylesheet', () => {
  const defined = definedClasses();
  const nowStyled = Object.keys(UNSTYLED)
    .filter((name) => defined.has(name))
    .sort();
  assert.deepEqual(
    nowStyled,
    [],
    'these UNSTYLED entries now have CSS rules, so the excuse is stale — ' +
      `delete them:\n${nowStyled.map((n) => `  ${n}`).join('\n')}`,
  );
});

test('every UNSTYLED entry carries a reason and a kind', () => {
  for (const [name, entry] of Object.entries(UNSTYLED)) {
    assert.ok(
      entry && (entry.kind === 'hook' || entry.kind === 'unstyled'),
      `UNSTYLED["${name}"] needs kind 'hook' or 'unstyled'`,
    );
    assert.ok(
      typeof entry.why === 'string' && entry.why.trim().length > 20,
      `UNSTYLED["${name}"] needs a reason that says where the class is used, or that nothing uses it`,
    );
  }
});
