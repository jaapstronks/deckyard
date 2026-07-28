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
 * That gap has a cost on the record. When `lijstje-slide` was folded into
 * `list-slide` (PR #451), the *offer* companions moved because the matrix named
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
 * only safe for now, is a worklist. Entries marked `promote` are the ones that
 * look like companions and are not gated as such yet.
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

  // --- the companions proper: gated by the matrix ---------------------------
  'client/views/editor/slide-type-picker/data.js': {
    kind: table,
    companion: 'picker-description',
    why:
      'SLIDE_TYPE_DESC, SLIDE_TYPE_ALIASES and PICKER_GROUPS — three per-type ' +
      'tables in one module, all three gated by the companion matrix.',
  },
  'client/views/settings/tabs/slide-types-tab/categories.js': {
    kind: table,
    companion: 'settings-curation-category',
    why: 'CATEGORIES, the settings curation grouping. One row per curated type.',
  },
  'client/views/editor/inline-edit/descriptors.js': {
    kind: table,
    companion: 'inline-edit-descriptor',
    why:
      'INLINE_DESCRIPTORS — which fields are inline-editable on canvas per type. ' +
      'An editing companion, so it outlives deprecation.',
  },
  'client/views/editor/editor-form/inspector-form.js': {
    kind: table,
    companion: 'inspector-keeps',
    why:
      'INSPECTOR_KEEPS — which fields stay in the inspector per type. Also an ' +
      'editing companion.',
  },
  'server/utils/openai/slide-types-prompt.js': {
    kind: table,
    companion: 'v1-manual-examples',
    why: 'MANUAL_EXAMPLES, the worked example the v1 prompt shows per type.',
  },
  'server/utils/ai/slide-catalog/diagram-slides.js': {
    kind: table,
    companion: 'ai-catalog',
    why:
      'The SLIDE_TYPE_CATALOG slice for the diagram geometries — comparison, ' +
      'matrix, pyramid, funnel, cycle, process, timeline. The agent-facing ' +
      'description, bestFor and notFor per type.',
  },
  'server/utils/ai/slide-catalog/interactive-slides.js': {
    kind: table,
    companion: 'ai-catalog',
    why:
      'The SLIDE_TYPE_CATALOG slice for the live types (poll, likert, ' +
      'likert-slider, feedback) plus countdown. A type with no entry is ' +
      'invisible to every agent surface, which is what #386 had to repair by hand.',
  },
  'server/utils/ai/slide-catalog/structural-slides.js': {
    kind: table,
    companion: 'ai-catalog',
    why:
      'The SLIDE_TYPE_CATALOG slice for the deck skeleton — title, ' +
      'chapter-title, quote, payoff, end. Same degradation: no entry, no agent ' +
      'can reach the type.',
  },
  'server/utils/ai/slide-catalog/visual-content-slides.js': {
    kind: table,
    companion: 'ai-catalog',
    why:
      'The SLIDE_TYPE_CATALOG slice for the types that carry a payload — ' +
      'image-text, image, gallery, table, chart.',
  },
  'server/utils/ai/slide-catalog/card-slides.js': {
    kind: table,
    companion: 'ai-catalog',
    why:
      'The SLIDE_TYPE_CATALOG slice for the card-shaped collections — ' +
      'icon-card-grid, text-blocks, kpi-metrics.',
  },
  'server/utils/ai/slide-catalog/examples/diagram-slides.js': {
    kind: table,
    companion: 'ai-examples',
    why:
      'The SLIDE_TYPE_EXAMPLES slice for the diagram geometries — the worked ' +
      'example an agent copies the field shape from.',
  },
  'server/utils/ai/slide-catalog/examples/basic-slides.js': {
    kind: table,
    companion: 'ai-examples',
    why:
      'The SLIDE_TYPE_EXAMPLES slice for the everyday types — content, list, ' +
      'quote, image-text, gallery, timeline. Without an example a model gets the ' +
      'field shape from the schema alone and fills it badly.',
  },
  'server/utils/ai/slide-catalog/examples/card-slides.js': {
    kind: table,
    companion: 'ai-examples',
    why:
      'The SLIDE_TYPE_EXAMPLES slice for the card collections — icon-card-grid, ' +
      'team-cards, logo-wall.',
  },
  'server/utils/ai/slide-catalog/examples/data-slides.js': {
    kind: table,
    companion: 'ai-examples',
    why:
      'The SLIDE_TYPE_EXAMPLES slice for the data types — kpi-metrics, table, ' +
      'chart, where a worked example carries the most weight because the field ' +
      'shape is the least guessable.',
  },

  // --- sparse tables: absence is normal, staleness is the defect ------------
  'scripts/generate-slide-css-aggregators.js': {
    kind: sparse,
    gate: 'tests/slide-css-aggregators.test.js',
    why:
      'TYPE_CSS maps a type to its stylesheet; only types with their own CSS ' +
      'appear. Already gated the right way — every key must be a registered ' +
      'type — which is why removing `lijstje-slide` at rung 3 will fail loudly ' +
      'here until the key is moved to `list-slide`.',
  },
  'shared/slide-types/convert.js': {
    kind: sparse,
    why:
      'The conversion map: which types a slide can turn into, and how the fields ' +
      'travel. Only meaningful pairs appear. **One of the three modules PR #451 ' +
      'missed** — the alias kept its entries while every insertion path moved, so ' +
      'new lists had no Convert submenu at all.',
  },
  'client/views/editor/editor-form/slide-form-router.js': {
    kind: sparse,
    why:
      'Which types get a curated editor form instead of the generic field order. ' +
      '**The second module PR #451 missed**: no case, so new lists fell back to ' +
      'the generic form.',
  },
  'client/views/editor/editor-form/render-field.js': {
    kind: sparse,
    why:
      'Field-level special cases (which field drives the slide-list label, which ' +
      'items editor uses one column). **The third module PR #451 missed**, in ' +
      'two places at once.',
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
  'client/views/editor/editor-utils.js': {
    kind: sparse,
    why:
      'Per-type label extraction for the slide list. The generic fallback covers ' +
      'most types; PR #451 removed one special case here because the fallback ' +
      'already did exactly the same thing.',
  },
  'server/utils/ai/schemas/refined-slide.js': {
    kind: sparse,
    promote: true,
    why:
      'Per-type JSON schema for the refine step. A type with no entry silently ' +
      'cannot be refined, which is companion-shaped degradation with no gate — ' +
      'the strongest candidate in this inventory for promotion to the matrix.',
  },
  'server/utils/ai/validate-slide-structure.js': {
    kind: sparse,
    promote: true,
    why:
      'Per-type structural validation of agent output. A type with no case is ' +
      'accepted unvalidated — also companion-shaped, also ungated.',
  },
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
      '`lijstje-slide` until brief A step 1 stopped it.',
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
  'client/views/follow/interactions.js': {
    kind: specific,
    why:
      'The live-interaction quartet (poll, likert, likert-slider, feedback): ' +
      'which slide the audience view accepts input on, and which widget it ' +
      'draws. One of nine modules that re-derive the same four names — see the ' +
      'measurement at the foot of the test.',
  },
  'client/views/presenter/interaction-controls.js': {
    kind: specific,
    why:
      'The quartet again, presenter side: whether the toolbar shows open/close ' +
      'voting and a live result count for the current slide.',
  },
  'client/views/presenter/deck-controller.js': {
    kind: specific,
    why:
      'Which slides the presenter treats as live and therefore polls for state: ' +
      'part of the quartet plus follow-invite. A fifth variation on the same ' +
      'question, with a slightly different answer — which is how these drift.',
  },
  'server/utils/interaction-helpers.js': {
    kind: specific,
    why:
      'The quartet again, plus the shape each one stores a response in (an ' +
      'option index, a scale value, free text). The closest thing to a real ' +
      'home for the capability, and still a hard-coded list.',
  },
  'server/routes/api/follow/helpers.js': {
    kind: specific,
    why:
      'The quartet again, deciding whether a follow request may submit anything ' +
      'for the slide it names. A security-adjacent copy of the same list.',
  },
  'server/routes/api/follow/interactions.js': {
    kind: specific,
    why:
      'The quartet again, validating the submitted payload against the type of ' +
      'the slide it targets.',
  },
  'server/routes/api/present-sessions.js': {
    kind: specific,
    why:
      'The quartet again, guarding which slide a running session will accept ' +
      'votes for and how it aggregates them.',
  },
  'server/storage/present-sessions/control.js': {
    kind: specific,
    why:
      'The quartet again, at the storage layer: which state a slide keeps while ' +
      'the session is live.',
  },
  'scripts/test-concurrent-votes.js': {
    kind: specific,
    why:
      'A load-test script that needs a votable slide to hammer, so it names the ' +
      'quartet too. Even the throwaway tooling pays for the missing capability.',
  },
  'client/views/editor/slides-panel.js': {
    kind: specific,
    why:
      'The interaction quartet (which slides get a live badge) plus ' +
      'follow-invite\'s singleton behaviour — one per deck, appended at the end.',
  },
  'client/lib/slide-runtime/slide-render.js': {
    kind: specific,
    why:
      'The three types that mount runtime behaviour after render: follow-invite, ' +
      'lead-capture and countdown. A closed set by construction — a type without ' +
      'a runtime hook needs no entry.',
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
  'server/utils/convert-file/helpers.js': {
    kind: specific,
    why:
      'Which types count as headings when splitting an imported document. Closed ' +
      'set: title, chapter-title, payoff.',
  },
  'scripts/migrate-slides.js': {
    kind: specific,
    why:
      'A historical one-off migration, frozen against the schema of the day. It ' +
      'must not learn about new types — rewriting it would rewrite history.',
  },
};

/**
 * The interaction quartet, named once here so the test can measure how many
 * modules re-derive it by hand.
 */
export const INTERACTION_TYPES = Object.freeze([
  'poll-slide',
  'likert-slide',
  'likert-slider-slide',
  'feedback-slide',
]);
