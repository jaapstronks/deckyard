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
 * family). Only the new names carried CSS. A fork's own title slide emitted the
 * old ones and fell back to bare document flow — a full-bleed title slide became
 * an inline image with the heading under it. Nothing broke that CI or an agent
 * watches: no import failed, the HTML was valid, 2151 tests were green, the site
 * returned 200. A human found it hours after deploy.
 *
 * So the class names a slide type emits are a **public contract**, and this test
 * is what makes that statement checkable. It also protects upstream from its own
 * dead classes, which is how the thirteen entries in {@link UNSTYLED} got found.
 *
 * See `docs/reference/slide-type-css-contract.md`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_SLIDE_TYPE_NAMES, SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { extractCssClasses } from '../scripts/lint-dead-css.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
 * `unstyled` — the class is emitted and nothing anywhere uses it. These are
 * *candidates for removal*, not settled design, and the list should shrink.
 * Removing one is a contract change under the rule this test enforces, so it
 * belongs in release notes and not in a drive-by commit — which is exactly why
 * they are recorded here instead of deleted in the same PR that found them.
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
  'aspect-square': { kind: 'unstyled', why: 'team-cards: emitted, referenced nowhere' },
  'shape-rounded': { kind: 'unstyled', why: 'team-cards: emitted, referenced nowhere' },
  'team-cards-group-left': {
    kind: 'unstyled',
    why: 'team-cards: emitted as the symmetry partner of the -right hook, but nothing reads it',
  },
  'is-layout-center': { kind: 'unstyled', why: 'chapter-title: emitted, referenced nowhere' },
  'kpi-note': { kind: 'unstyled', why: 'kpi-metrics: emitted, referenced nowhere' },
  'quote-author-text': { kind: 'unstyled', why: 'quote: emitted, referenced nowhere' },
  'poll-results-main': {
    kind: 'unstyled',
    why: 'poll/likert/likert-slider: emitted, referenced nowhere',
  },
  'sfi-header': { kind: 'unstyled', why: 'feedback + follow-invite: emitted, referenced nowhere' },
  'sfi-card-code': { kind: 'unstyled', why: 'feedback + follow-invite: emitted, referenced nowhere' },
  'sfi-card-qr': { kind: 'unstyled', why: 'feedback + follow-invite: emitted, referenced nowhere' },
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
    for (const rec of extractCssClasses(fs.readFileSync(file, 'utf8'), file)) out.add(rec.name);
  }
  return out;
}

/**
 * The content objects to render a type with: its defaults, plus one variant per
 * option of every enum-ish field.
 *
 * Rendering defaults alone misses the whole `is-*` family — the layout,
 * alignment and background modifiers that only appear on a non-default value,
 * and those are exactly the names a restyle renames. Enumerating the declared
 * options costs 758 renders across the registry and finds four classes the
 * defaults never emit.
 *
 * @param {object} def
 * @returns {object[]}
 */
function contentVariants(def) {
  const base = structuredClone(def.defaults || {});
  const out = [base];
  for (const field of def.fields || []) {
    const options = Array.isArray(field.options) ? field.options : null;
    if (!options) continue;
    for (const option of options) {
      const value =
        option && typeof option === 'object' ? (option.value ?? option.id ?? option.key) : option;
      if (value === undefined) continue;
      out.push({ ...base, [field.key]: value });
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
    for (const rec of extractCssClasses(match[1], 'inline <style>')) selfStyled.add(rec.name);
  }
  return { emitted, selfStyled };
}

/** @type {Map<string, Set<string>>} class name → the types that emit it */
const EMITTED = new Map();
/** @type {Set<string>} classes a type styles through its own inline <style> */
const SELF_STYLED = new Set();

for (const type of CORE_SLIDE_TYPE_NAMES) {
  const def = SLIDE_TYPES[type];
  for (const content of contentVariants(def)) {
    let html;
    try {
      html = renderSlideHtml({ type, content }, { lang: 'nl' });
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
      { type, content: structuredClone(SLIDE_TYPES[type].defaults || {}) },
      { lang: 'nl' }
    );
    assert.match(html, /class="/, `${type} rendered no classes at all`);
  }
  assert.ok(EMITTED.size > 100, `expected many emitted classes, got ${EMITTED.size}`);
});

test('every class a slide type emits resolves to a CSS rule', () => {
  const defined = definedClasses();
  assert.ok(defined.size > 1000, `expected the stylesheets to define many classes, got ${defined.size}`);

  const orphans = [...EMITTED.keys()]
    .filter((name) => !defined.has(name))
    .filter((name) => !SELF_STYLED.has(name))
    .filter((name) => !Object.hasOwn(UNSTYLED, name))
    .sort();

  assert.deepEqual(
    orphans,
    [],
    'these classes are rendered but have no CSS rule anywhere:\n' +
      orphans.map((n) => `  .${n}  (from ${[...EMITTED.get(n)].join(', ')})`).join('\n') +
      '\n\nA class with no rule renders as bare document flow — valid HTML, green ' +
      'tests, wrong page. If you renamed a class, rename it in the stylesheet too ' +
      'and put the rename in the release notes (docs/reference/versioning.md ' +
      '§ Renamed slide-type classes). If the class is a selector hook or a known ' +
      'leftover, add it to UNSTYLED in this file with a reason.'
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
      `delete them:\n${stale.map((n) => `  ${n}`).join('\n')}`
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
      `delete them:\n${nowStyled.map((n) => `  ${n}`).join('\n')}`
  );
});

test('every UNSTYLED entry carries a reason and a kind', () => {
  for (const [name, entry] of Object.entries(UNSTYLED)) {
    assert.ok(
      entry && (entry.kind === 'hook' || entry.kind === 'unstyled'),
      `UNSTYLED["${name}"] needs kind 'hook' or 'unstyled'`
    );
    assert.ok(
      typeof entry.why === 'string' && entry.why.trim().length > 20,
      `UNSTYLED["${name}"] needs a reason that says where the class is used, or that nothing uses it`
    );
  }
});
