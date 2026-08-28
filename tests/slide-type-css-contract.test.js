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
 * **It reads `CORE_SLIDE_TYPE_DEFS`, never `SLIDE_TYPES`.** A fork may override a
 * core name with `override: true`, and that type's classes are styled by the
 * fork's own CSS, which upstream does not have — asserting against them would
 * make this the very thing the briefing warns about: an upstream test that
 * assumes something a fork replaces by definition. `ctx.slideTypes` is how the
 * core definition is rendered even when an override is installed. A fork wanting
 * this check on its own types writes its own, over its own stylesheets.
 *
 * See `docs/reference/slide-type-css-contract.md`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORE_SLIDE_TYPE_DEFS,
  CORE_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { resolveItemDefaults } from '../shared/slide-types/item-defaults.js';
import { extractCssClasses } from '../scripts/lint-dead-css.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const STYLES_DIR = path.join(REPO_ROOT, 'client', 'styles');

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
 * Every `.css` file under `client/styles/`, absolute.
 * @param {string} dir
 * @returns {string[]}
 */
function cssFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFilesUnder(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/**
 * Class names that have at least one rule in the app stylesheets.
 * @returns {Set<string>}
 */
function definedClasses() {
  const out = new Set();
  for (const file of cssFilesUnder(STYLES_DIR)) {
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
 * Class names appearing in `class="…"`, plus any classes the markup styles
 * itself through an inline `<style>` block (a type may ship its own rules; a
 * fork type is the likely case).
 * @param {string} html
 * @returns {{ emitted: Set<string>, selfStyled: Set<string> }}
 */
function classesIn(html) {
  const emitted = new Set();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const name of match[1].split(/\s+/)) if (name) emitted.add(name);
  }
  const selfStyled = new Set();
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const rec of extractCssClasses(match[1], 'inline <style>'))
      selfStyled.add(rec.name);
  }
  return { emitted, selfStyled };
}

/** @type {Map<string, Set<string>>} class name → the types that emit it */
const EMITTED = new Map();
/** @type {Set<string>} classes a type styles through its own inline <style> */
const SELF_STYLED = new Set();

for (const type of CORE_SLIDE_TYPE_NAMES) {
  const def = CORE_SLIDE_TYPE_DEFS[type];
  for (const content of contentVariants(def)) {
    let html;
    try {
      html = renderSlideHtml(
        { type, content },
        { lang: 'nl', slideTypes: CORE_SLIDE_TYPE_DEFS },
      );
    } catch {
      // A variant a type rejects is not this test's business; the defaults
      // render is asserted separately below.
      continue;
    }
    const { emitted, selfStyled } = classesIn(html);
    for (const name of emitted) {
      if (!EMITTED.has(name)) EMITTED.set(name, new Set());
      EMITTED.get(name).add(type);
    }
    for (const name of selfStyled) SELF_STYLED.add(name);
  }
}

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

  const orphans = [...EMITTED.keys()]
    .filter((name) => !defined.has(name))
    .filter((name) => !SELF_STYLED.has(name))
    .filter((name) => !Object.hasOwn(UNSTYLED, name))
    .sort();

  assert.deepEqual(
    orphans,
    [],
    'these classes are rendered but have no CSS rule anywhere:\n' +
      orphans
        .map((n) => `  .${n}  (from ${[...EMITTED.get(n)].join(', ')})`)
        .join('\n') +
      '\n\nA class with no rule renders as bare document flow — valid HTML, green ' +
      'tests, wrong page. If you renamed a class, rename it in the stylesheet too ' +
      'and put the rename in the release notes (docs/reference/versioning.md ' +
      '§ Renamed slide-type classes). If the class is a selector hook or a known ' +
      'leftover, add it to UNSTYLED in this file with a reason.',
  );
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
