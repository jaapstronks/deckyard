/**
 * The AI-catalog aggregator is derived, not hand-maintained.
 *
 * `server/utils/ai/slide-catalog/type-ai.js` is the one import list the agent
 * catalog uses to reach a slide type's editorial copy. It replaced five
 * hand-filed category modules (structural / card / diagram / interactive /
 * visual-content, plus three thin re-export shims) whose grouping was a filing
 * decision nobody could derive from the type — and which disagreed with the
 * `category` field inside the very entries they held.
 *
 * Gates: byte-identical to the generator's output, every committed entry points
 * at a real type directory, the catalog is wired to it, and — the one that is
 * specific to this facet — the copy stays off the browser's payload. See
 * scripts/generate-slide-ai-aggregator.js.
 *
 * Run with: node --test tests/slide-ai-aggregator.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AGGREGATOR_PATH,
  REPO_ROOT,
  TYPES_DIR,
  buildAggregator,
  examplesIdentifierFor,
  identifierFor,
  typesWithAi,
  typesWithAiExamples,
} from '../scripts/generate-slide-ai-aggregator.js';
import {
  SLIDE_TYPE_AI,
  SLIDE_TYPE_AI_EXAMPLES,
} from '../server/utils/ai/slide-catalog/type-ai.js';
import { SLIDE_TYPE_EXAMPLES } from '../server/utils/ai/slide-catalog/examples.js';
import {
  CATALOG_ORDER,
  getCoreSlideCatalog,
} from '../server/utils/ai/slide-catalog/definitions.js';
import { CORE_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';

test('the committed aggregator is byte-identical to the generated output', () => {
  const actual = fs.readFileSync(path.join(REPO_ROOT, AGGREGATOR_PATH), 'utf8');
  assert.equal(
    actual,
    buildAggregator(),
    `${AGGREGATOR_PATH} is out of date — run \`npm run gen:slide-ai\``
  );
});

test('every type directory with an ai.js is in the aggregator', () => {
  // The forward direction: a type that grows editorial copy but never reaches
  // the aggregator is withheld from agents, silently.
  assert.deepEqual(Object.keys(SLIDE_TYPE_AI).sort(), typesWithAi());
});

test('every aggregator entry names a real core type', () => {
  const core = new Set(CORE_SLIDE_TYPE_NAMES);
  for (const name of typesWithAi()) {
    assert.ok(
      core.has(name),
      `the aggregator has "${name}" but it is not a registered core type — ` +
        'a leftover directory after a type was retired'
    );
    assert.ok(
      fs.existsSync(path.join(TYPES_DIR, name, 'ai.js')),
      `the aggregator imports types/${name}/ai.js, which does not exist`
    );
  }
});

test('a directory name maps to exactly one import identifier', () => {
  const ids = [
    ...typesWithAi().map(identifierFor),
    ...typesWithAiExamples().map(examplesIdentifierFor),
  ];
  assert.equal(new Set(ids).size, ids.length, `duplicate import identifiers: ${ids}`);
});

test('every ai.js that exports aiExamples is in the examples map, and only those', () => {
  // The forward direction for the sparse companion: a type that writes
  // examples but never reaches the aggregator shows the model a bare schema,
  // silently. The map staying sparse is equally deliberate — absence means the
  // type has no examples, not that one should be invented.
  assert.deepEqual(Object.keys(SLIDE_TYPE_AI_EXAMPLES).sort(), typesWithAiExamples());
});

test('the aiExamples detector agrees with the real module namespace', async () => {
  // typesWithAiExamples() detects by source text (`export const aiExamples`).
  // A renamed export — `const EX = […]; export { EX as aiExamples };` — would
  // slip past that regex and ship a type whose examples never reach the
  // prompt, silently. Import every ai.js and pin the detector to what the
  // module actually exports, in both directions.
  const detected = new Set(typesWithAiExamples());
  for (const name of typesWithAi()) {
    const mod = await import(pathToFileURL(path.join(TYPES_DIR, name, 'ai.js')));
    assert.equal(
      'aiExamples' in mod,
      detected.has(name),
      `types/${name}/ai.js: the aiExamples export and the source-text detector disagree`
    );
  }
});

test('the examples surface is the aggregator', () => {
  // examples.js no longer holds any content; it overlays fork examples onto
  // what the aggregator gives it. If that wiring is dropped, two prompt
  // surfaces lose their worked content and the companion matrix goes quietly
  // empty. (Entry identity holds before any custom merge; custom/ types are
  // absent in the test environment.)
  assert.deepEqual(
    Object.keys(SLIDE_TYPE_EXAMPLES).sort(),
    Object.keys(SLIDE_TYPE_AI_EXAMPLES).sort()
  );
  for (const name of Object.keys(SLIDE_TYPE_AI_EXAMPLES)) {
    assert.equal(
      SLIDE_TYPE_EXAMPLES[name],
      SLIDE_TYPE_AI_EXAMPLES[name],
      `${name} is not the aggregator's entry`
    );
  }
});

test('the catalog is the aggregator, laid out in CATALOG_ORDER', () => {
  // definitions.js no longer holds any copy; it orders what the aggregator
  // gives it. If that wiring is dropped the companion matrix would go quietly
  // empty, and three prompt surfaces would lose their sections.
  const catalog = getCoreSlideCatalog();
  assert.deepEqual(Object.keys(catalog).sort(), Object.keys(SLIDE_TYPE_AI).sort());
  for (const name of Object.keys(SLIDE_TYPE_AI)) {
    assert.equal(catalog[name], SLIDE_TYPE_AI[name], `${name} is not the aggregator's entry`);
  }
});

test('the order hint places every catalogued type, and names no ghost', () => {
  // A hint may legitimately be partial — an unnamed type sorts after the named
  // ones — but a hint that has silently stopped covering the catalog is a
  // curation decision that has quietly reverted to alphabetical. Both
  // directions are cheap to state, so state them.
  const catalogued = new Set(Object.keys(SLIDE_TYPE_AI));
  const unplaced = [...catalogued].filter((t) => !CATALOG_ORDER.includes(t)).sort();
  assert.deepEqual(
    unplaced,
    [],
    'these types are catalogued but unplaced, so they sort last in every prompt'
  );
  const ghosts = CATALOG_ORDER.filter((t) => !catalogued.has(t)).sort();
  assert.deepEqual(ghosts, [], 'CATALOG_ORDER names types the catalog no longer has');
  assert.equal(Object.keys(getCoreSlideCatalog())[0], CATALOG_ORDER[0]);
});

test('the editorial copy stays out of the browser payload', () => {
  // The boundary rule, from this side: an `ai.js` may only be reached from
  // server/. tests/slide-type-directory-boundary.test.js walks the real module
  // graph from the render entry; this is the cheap static half, and it is the
  // one that catches a well-meaning `shared/slide-types/ai.js` aggregator.
  assert.ok(
    AGGREGATOR_PATH.startsWith(`server${path.sep}`),
    'the aggregator must live under server/ — it is ~168 KB of prose the browser never runs'
  );
  const offenders = [];
  for (const dir of ['client', 'shared']) {
    walk(path.join(REPO_ROOT, dir), (file) => {
      if (!file.endsWith('.js')) return;
      const src = fs.readFileSync(file, 'utf8');
      // Anchored on the type directory: `shared/constants/ai.js` is a different
      // file with the same basename, and it is browser-side on purpose.
      if (/from\s+['"][^'"]*types\/[a-z0-9-]+\/ai\.js['"]/.test(src)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    });
  }
  assert.deepEqual(offenders, [], 'a browser-side module imports a type\'s ai.js');
});

/** Depth-first walk over a directory tree. */
function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}
