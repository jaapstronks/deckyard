/**
 * The name-branching inventory — assertion 5 of brief B, and the answer to a
 * question PR #451 asked the hard way.
 *
 * `tests/slide-type-companion-coverage.test.js` guards the hand-maintained
 * *companions*: does every type that owes a picker description have one, is
 * there a catalog entry left behind for a type that is gone. It works, and it
 * has caught real rot. What it cannot do is notice a module it has never heard
 * of. The matrix is itself a hand-written list, and nobody was guarding drift in
 * the matrix — which is the exact class of failure the `structure` facet exists
 * to kill, one layer up.
 *
 * That gap has a cost on the record. When the List type's Dutch alias was folded
 * into `list-slide` (PR #451), the *offer* companions moved because the matrix named
 * them, and `shared/slide-types/convert.js`, `slide-form-router.js` and two
 * special cases in `render-field.js` stayed behind because it did not. Net
 * effect: newly authored lists lost affordances that legacy lists kept — the
 * asymmetry exactly backwards, with the whole **Convert** submenu missing,
 * because `getConvertibleSlideTypes('list-slide')` returned `[]`.
 *
 * So this module derives, rather than declares, the set of places that carry
 * per-type knowledge: every tracked module that branches on three or more core
 * slide-type names. Each one must be accounted for in `INVENTORY` below, with a
 * kind and a reason. The gate is on the *accounting*, not on the contents — a
 * module may legitimately be a closed-set special case; it may not be a
 * surprise.
 *
 * Human-facing version: docs/reference/slide-type-companions.md.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { SLIDE_TYPES, CUSTOM_SLIDE_TYPE_NAMES } from '../../shared/slide-types/registry.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * How many distinct type names a module has to branch on before it owes an
 * inventory entry.
 *
 * Not a silent cap — the number is the whole judgement, so it is here in the
 * open. One or two names is how *type-specific behaviour* reads: the custom-HTML
 * guard exists for `custom-html-slide`, the chart data modal for `chart-slide`,
 * and no future type will ever be "missing" from them. Three or more is where a
 * module stops being about a type and starts being a table *of* types, and a
 * table is a thing a new type can fall out of. 94 modules name a type; 46 branch
 * on three or more.
 *
 * Lowering this to 2 would add ~20 pair-shaped special cases (a migration that
 * renames one type into another, a keyboard handler that treats title and
 * chapter-title alike) whose reasons would all read "these two, by nature". The
 * gate would get noisier without getting stricter, so: 3, written down.
 *
 * (Those counts are the reading from 2026-07-28. Ten modules left the inventory
 * when the `runtime` facet landed, which is the shape of progress this gate is
 * supposed to produce: the number goes down because knowledge moved onto the
 * types, not because the threshold moved.)
 */
export const BRANCH_THRESHOLD = 3;

/** Core (non-fork) type names — the vocabulary a module can branch on. */
export const CORE_TYPE_NAMES = Object.keys(SLIDE_TYPES).filter(
  (name) => !CUSTOM_SLIDE_TYPE_NAMES.includes(name)
);

/**
 * Trees that are out of scope. Tests are allowed — required, even — to name
 * types; `custom/` is fork-local and cannot be held to a core inventory (the
 * same line `git ls-files` draws in tests/removed-slide-types.test.js); the eval
 * suite is fixture data.
 */
const SKIP_PREFIXES = ['tests/', 'custom/', 'test-suite/'];

/**
 * Blank out comments so prose does not read as code. Block comments keep their
 * newlines so reported line numbers stay honest.
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * The shapes that count as *branching* on a name, as opposed to mentioning it.
 * Deliberately generous: an object key counts, because a map keyed by type is
 * the most common per-type table in this codebase, and a bare list member counts
 * because a `Set` of types is the second most common.
 * @param {string} name
 * @returns {RegExp[]}
 */
function branchPatterns(name) {
  const q = `(['"\`])${name}\\1`;
  return [
    new RegExp(`[=!]==?\\s*${q}`), //           x === 'name'
    new RegExp(`${q}\\s*[=!]==?`), //           'name' === x
    new RegExp(`case\\s+${q}`), //              case 'name'
    new RegExp(`${q}\\s*:`), //                 { 'name': … }
    new RegExp(`\\[\\s*${q}`), //               ['name', …]  /  x['name']
    new RegExp(`,\\s*${q}`), //                 […, 'name']
    new RegExp(`includes\\(\\s*${q}`),
    new RegExp(`has\\(\\s*${q}`),
    new RegExp(`\\?\\??\\s*${q}`), //           x ?? 'name'
  ];
}

/**
 * Every tracked JS module that branches on at least `BRANCH_THRESHOLD` core
 * type names, with the names it branches on.
 *
 * `git ls-files`, so an unstaged new module is invisible until it is added —
 * the same line tests/removed-slide-types.test.js draws, and the same
 * consequence: the gate lands when the file is committed, which is when CI sees
 * it and before any reviewer does.
 *
 * @returns {Map<string, string[]>} repo-relative path -> type names
 */
export function deriveNameBranchingModules() {
  const files = execSync('git ls-files "*.js"', { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  const out = new Map();
  for (const file of files) {
    if (SKIP_PREFIXES.some((p) => file.startsWith(p))) continue;
    const src = stripComments(readFileSync(resolve(ROOT, file), 'utf8'));
    const names = CORE_TYPE_NAMES.filter(
      (name) => src.includes(name) && branchPatterns(name).some((re) => re.test(src))
    );
    if (names.length >= BRANCH_THRESHOLD) out.set(file, names);
  }
  return out;
}

/**
 * What kind of per-type knowledge a module carries. The kind decides what
 * "keeping it honest" even means, which is why the inventory records it rather
 * than treating all 46 modules as one undifferentiated pile.
 */
export const KINDS = Object.freeze({
  /**
   * A per-type table where every eligible type owes a row, and a missing row
   * degrades silently. These are the companions proper: the entry must name a
   * companion in tests/helpers/slide-type-companions.js, which gates them in
   * both directions.
   */
  table: 'table',
  /**
   * A per-type table that is *intentionally* partial — repair rules, conversion
   * pairs, curated forms, the CSS map. Most types have no entry and should not.
   * Only staleness is a defect, and only some of these have a gate for it yet.
   */
  sparse: 'sparse',
  /**
   * Not a table: the module branches on a closed set of types because those
   * types behave differently, and a new type will never be "missing" from it.
   */
  specific: 'specific',
  /** Produced by a script from per-type sources, so drift is impossible. */
  generated: 'generated',
  /** The registry itself — the list every other list is derived from. */
  source: 'source',
});

const { table, sparse, specific, generated, source } = KINDS;

/**
 * Every module that branches on three or more type names, and what it is.
 *
 * The reason field is the point. An inventory that says "yes, we know" for 46
 * modules is worth nothing; one that says *why* each is safe, and which ones are
 * only safe for now, is a worklist. `promote: true` used to flag the modules
 * that looked like companions and were not gated as such; the last two —
 * refined-slide.js and validate-slide-structure.js — were promoted to the matrix
 * (kind `table`), so no entry carries it now. A future ungated per-type table
 * should get it again as a signpost to the next promotion.
 *
 * @type {Record<string, {kind: string, companion?: string, gate?: string, promote?: boolean, why: string}>}
 */
export const INVENTORY = {
  // --- the registry and its generated aggregators ---------------------------
  'shared/slide-types/registry.js': {
    kind: source,
    why:
      'The registry map itself. Every core type is here by definition — a type ' +
      'missing from this file does not exist — so there is no drift to catch.',
  },
  'shared/slide-types/authoring.js': {
    kind: generated,
    gate: 'scripts/generate-slide-authoring-aggregator.js',
    why:
      'Generated aggregator over each type\'s own authoring.js (sample content, ' +
      'schematic). Regenerating it is the only way to change it, so it cannot ' +
      'drift from the per-type sources it imports.',
  },
  'server/utils/ai/slide-catalog/type-ai.js': {
    kind: generated,
    gate: 'scripts/generate-slide-ai-aggregator.js',
    why:
      'Generated aggregator over each type\'s own ai.js (the agent-facing ' +
      'description, bestFor and notFor, plus the sparse aiExamples the prompt ' +
      'shows as worked content). It replaced five hand-filed category modules ' +
      'whose grouping was not derivable from anything the type declares — and, ' +
      'for the examples, four more of the same. Regenerating it is the only ' +
      'way to change it.',
  },
  'server/utils/ai/slide-catalog/definitions.js': {
    kind: sparse,
    why:
      'CATALOG_ORDER — the sequence the catalog is presented in to a model, ' +
      'which three prompt surfaces iterate. Deliberately a partial hint, the ' +
      'same split PICKER_GROUP_ORDER makes: membership comes from the type ' +
      'directories, order stays with the surface. An unnamed type sorts after ' +
      'the named ones and a stale name is ignored, so it cannot hide a type.',
  },
  'shared/slide-types/inline-edit.js': {
    kind: generated,
    gate: 'scripts/generate-slide-inline-edit-aggregator.js',
    why:
      'Generated aggregator over each type\'s own inline-edit.js (the on-canvas ' +
      'editing descriptor). Regenerating it is the only way to change it, so it ' +
      'cannot drift from the per-type sources it imports.',
  },
  'shared/slide-types/tiers.js': {
    kind: specific,
    gate: 'tests/slide-type-tiers.test.js',
    why:
      'CORE_PROFILE — the nine tier-1 names. Deliberately a closed set, and the ' +
      'one list here a new type must never join by default: adding a type adds ' +
      'a tier-2 name, and widening the normative profile is a spec decision the ' +
      'gate pins by value. The obligation a new type does carry — declaring a ' +
      '`fallback` into the profile — lives on its own definition, so this module ' +
      'reads the declaration rather than tabulating it and cannot go stale.',
  },

  // --- the companions proper: gated by the matrix ---------------------------
  'client/views/editor/slide-type-picker/data.js': {
    kind: sparse,
    why:
      'PICKER_GROUP_ORDER and SLIDE_TYPE_PRESETS — an order hint per shelf and a ' +
      'curated set of layout-variant tiles, both intentionally partial. The ' +
      'three per-type tables that used to live here are gone: PICKER_GROUPS ' +
      '(membership), SLIDE_TYPE_DESC and SLIDE_TYPE_ALIASES all moved onto the ' +
      'types, and the picker reads description/aliases through the facet module ' +
      'off the /api/slide-types response. Only staleness of the hint remains.',
  },
  'client/views/editor/editor-form/inspector-form.js': {
    kind: sparse,
    why:
      'No longer the keep-list table: INSPECTOR_KEEPS is re-exported from the ' +
      'generated inline-edit aggregator, and each type declares its own keeps ' +
      'in types/<name>/inline-edit.js. What still names types here is ' +
      'renderInspectorExtrasByType — the per-type widget blocks a flat ' +
      'keep-list cannot express (chart data editor, image focus/zoom pickers, ' +
      'per-column image cards). Intentionally partial: a type without a case ' +
      'renders through the generic keeps loop, which is the right default.',
  },
  'server/utils/openai/slide-types-prompt.js': {
    kind: table,
    companion: 'v1-manual-examples',
    why: 'MANUAL_EXAMPLES, the worked example the v1 prompt shows per type.',
  },
  'server/utils/ai/schemas/refined-slide.js': {
    kind: table,
    companion: 'refine-schema',
    why:
      'SLIDE_SCHEMAS — the per-type Zod schema the refine phase validates agent ' +
      'content against. Every agent-emittable type owes one; a missing entry ' +
      'silently skips validation. Promoted from a `promote: true` sparse entry.',
  },
  'server/utils/ai/validate-slide-structure.js': {
    kind: table,
    companion: 'structure-validation',
    why:
      'STRUCTURE_VALIDATORS — the per-type structural check for agent output. ' +
      'Owed by every non-opt-out collection / fixed-collection type; a missing ' +
      'entry accepts a malformed collection unvalidated. Promoted from `promote`.',
  },

  // --- display-order hint: membership is derived, order is curated ---------
  'client/views/settings/tabs/slide-types-tab/categories.js': {
    kind: sparse,
    gate: 'tests/slide-type-groups.test.js',
    why:
      'CATEGORY_ORDER — heading order plus, per heading, which types lead. It ' +
      'used to be CATEGORIES, a second hand-written membership that disagreed ' +
      'with the picker about five types; membership now lives on the types and ' +
      'this is an order hint, so staleness is the only defect left.',
  },

  // --- sparse tables: absence is normal, staleness is the defect ------------
  'scripts/generate-slide-css-aggregators.js': {
    kind: sparse,
    gate: 'tests/slide-css-aggregators.test.js',
    why:
      'TYPE_CSS maps a type to its stylesheet; only types with their own CSS ' +
      'appear. Already gated the right way — every key must be a registered ' +
      'type — which is why rung 3 of the list consolidation had to rekey the ' +
      'List stylesheet from the retired Dutch alias to `list-slide`.',
  },
  'shared/slide-types/convert.js': {
    kind: sparse,
    why:
      'The conversion map: which types a slide can turn into, and how the fields ' +
      'travel. Only meaningful pairs appear. **One of the three modules PR #451 ' +
      'missed** — the alias kept its entries while every insertion path moved, so ' +
      'new lists had no Convert submenu at all.',
  },
  // slide-form-router.js is deliberately ABSENT since editor-behaviour-
  // abstraction step 5: the table that once listed sixteen types is down to a
  // single documented exception (follow-invite), below the three-name
  // threshold. That is the good outcome this gate exists to surface — the
  // per-type knowledge was derived away, not moved.
  'client/views/editor/editor-form/render-field.js': {
    kind: sparse,
    why:
      'Field-level special cases: which types auto-fit a freshly picked image, ' +
      'and which get the heading toolbar button. **The third module PR #451 ' +
      'missed.** The slide-list-label table it also carried is gone — ' +
      'affectsLabelForSlide now reads the labelField declaration.',
  },
  'client/views/editor/editor-form/header-actions.js': {
    kind: sparse,
    why:
      'The convert targets offered in the editor header — the same knowledge as ' +
      'convert.js, expressed a second time. Worth collapsing into one source; ' +
      'until then, two places to visit.',
  },
  'client/views/editor/editor-form/element-tab.js': {
    kind: sparse,
    why:
      'Which sub-element kinds (image, card, member, column) the element tab ' +
      'offers per type. Absence means the tab shows the slide-level fields only.',
  },
  // editor-utils.js left the inventory with the A7.13 done-gate pass: its
  // per-type label extraction ("backwards compatibility" branches shadowing
  // the labelField declaration that already existed) collapsed into
  // labelField + the generic title fallback. The knowledge moved onto the
  // types — quote-slide, poll-slide and image-slide declare their driver.
  'server/utils/ai/validate-slides/fix.js': {
    kind: sparse,
    why:
      'Repair rules for agent output (too few items, wrong field). Genuinely ' +
      'partial: a rule exists where a model reliably gets a type wrong.',
  },
  'server/utils/ai/validate-slides/constants.js': {
    kind: sparse,
    why:
      'Item-count limits per collection type, plus the closing-type list. Only ' +
      'types with a limit worth stating appear.',
  },
  'server/utils/openai/convert-slide.js': {
    kind: sparse,
    why:
      'The v1 AI conversion pairs — a third expression of the knowledge in ' +
      'convert.js and header-actions.js. Three copies of one map is the clearest ' +
      'argument in this inventory for deriving conversion from the structure facet.',
  },
  'server/utils/markdown-import/map.js': {
    kind: sparse,
    why:
      'Which builder each markdown construct maps to. Partial by nature: only ' +
      'types markdown can express appear. This is the module that kept minting ' +
      'the retired Dutch list alias until brief A step 1 stopped it.',
  },
  'server/export/print.js': {
    kind: sparse,
    why:
      'Print/PDF layout hints per type (which types break a page, which get a ' +
      'quote treatment). Absence means the default treatment, which is fine.',
  },
  'shared/data-source.js': {
    kind: sparse,
    why:
      'Which types can bind an external data source and onto which field. Only ' +
      'types with a bindable collection appear.',
  },

  // --- closed-set special cases: not tables --------------------------------
  //
  // Ten entries left this section when the `runtime` facet landed: nine that
  // hand-rolled the live-interaction set plus the presenter's deck controller,
  // which answered the same question a tenth way. They ask the type now.
  'client/lib/slide-runtime/slide-render.js': {
    kind: specific,
    why:
      'The three types that mount runtime behaviour after render: follow-invite, ' +
      'lead-capture and countdown. A closed set by construction — a type without ' +
      'a runtime hook needs no entry. Note this is *not* the `runtime` facet: ' +
      'that one is about what the session does for a slide, and cuts the set ' +
      'differently (these three are static, static and timed). One consumer, one ' +
      'near-miss axis, deliberately not folded in.',
  },
  'server/mcp/tools.js': {
    kind: specific,
    why:
      'The default title type, the closing-type set, and type names inside ' +
      'parameter descriptions. Not a per-type table.',
  },
  'server/utils/ai/refine-slides.js': {
    kind: specific,
    why:
      'Fallback candidates per editorial role (a title role falls back to ' +
      'title-slide). A short closed list, not a per-type row.',
  },
  // server/utils/convert-file/helpers.js left the inventory 2026-08-01: its
  // only 3+-name branch was a dead exclusion list behind a content-slide
  // check (the includes() could never fire) and was removed outright.
  'scripts/migrate-slides.js': {
    kind: specific,
    why:
      'A historical one-off migration, frozen against the schema of the day. It ' +
      'must not learn about new types — rewriting it would rewrite history.',
  },
};

// The interaction quartet used to be named here, so the test could measure how
// many modules re-derived it by hand. The answer was nine, which is why the
// types now declare `runtime: 'live'` and the set comes from
// shared/slide-types/runtime.js. The measurement lives on as a ceiling in
// tests/slide-type-runtime.test.js: no module may write the set out again.
