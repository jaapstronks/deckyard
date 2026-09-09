import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  SLIDE_TYPES,
  CORE_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import {
  DEFAULT_FIDELITY,
  FIDELITY_TARGETS,
  SLIDE_FIDELITY_NAMES,
  exportFidelity,
  slideFidelity,
} from '../shared/slide-types/fidelity.js';
import {
  NATIVE_PPTX_SLIDE_TYPES,
  unbackedFidelityClaims,
} from '../server/export/pptx.js';

/**
 * The `fidelity` facet's guardrail.
 *
 * `structure` is checked against the field schema, which already knows the
 * shape of the content. `runtime` has no oracle at all and is checked from the
 * other end — nothing may re-derive the live set by hand. `fidelity` sits
 * between them: it has an oracle, but the oracle is in the export rather than
 * in the type, and it can only be consulted in one place. So:
 *
 * 1. **Completeness** — every core type answers for every target. Silence must
 *    not be a fourth value, for the reason it is not one for `structure`: an
 *    undeclared type and a deliberately-rastered one would then be
 *    indistinguishable, and only one of them has been thought about.
 * 2. **Truthfulness** — a type declaring anything but `raster` is claiming a
 *    native composition exists. Checked against the export's own handler map,
 *    in both directions, because both drifts are real: a declaration that
 *    outruns the implementation quietly rasterises a slide the user was
 *    promised would be editable, and an implementation nothing declares is a
 *    mapper that never runs.
 * 3. **No second definition** — the export dispatches on the facet, not on type
 *    names. This is the branch the facet retired, kept as a ceiling: `pptx.js`
 *    had exactly one name in it, which is precisely why nothing was guarding
 *    it, and one name is how every hand-rolled list starts.
 *
 * Run with: node --test tests/slide-type-fidelity.test.js
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- assertion 1: completeness --------------------------------------------

test('every core slide type declares a fidelity for every export target', () => {
  const missing = [];
  for (const name of CORE_SLIDE_TYPE_NAMES) {
    const def = SLIDE_TYPES[name];
    for (const target of FIDELITY_TARGETS) {
      if (!slideFidelity(def, target)) {
        const declared = def?.fidelity?.[target];
        missing.push(
          `${name}: fidelity.${target} is ${
            declared === undefined ? 'missing' : JSON.stringify(declared)
          }`,
        );
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    `every type must declare one of ${SLIDE_FIDELITY_NAMES.join(', ')} per ` +
      `target (${FIDELITY_TARGETS.join(', ')}):\n` +
      missing.join('\n'),
  );
});

test('an undeclared type resolves to the honest default', () => {
  // The seam rule the export leans on: a deck can outlive the code that
  // rendered it, and a fork type may declare nothing at all. Neither may throw,
  // and neither may claim an editable export it will not get.
  assert.equal(exportFidelity(undefined, 'pptx'), DEFAULT_FIDELITY);
  assert.equal(exportFidelity({}, 'pptx'), DEFAULT_FIDELITY);
  assert.equal(
    exportFidelity({ fidelity: { pptx: 'gorgeous' } }, 'pptx'),
    DEFAULT_FIDELITY,
  );
  // An unknown target is not a value either — asking about DOCX today is a
  // question this codebase has no answer to, not a promise of one.
  assert.equal(slideFidelity({ fidelity: { docx: 'native' } }, 'docx'), '');
});

// --- assertion 2: truthfulness ---------------------------------------------

test('a type claims native PPTX only where the export has a composition', () => {
  const claimed = CORE_SLIDE_TYPE_NAMES.filter(
    (name) => slideFidelity(SLIDE_TYPES[name], 'pptx') !== 'raster',
  ).sort();
  const implemented = [...NATIVE_PPTX_SLIDE_TYPES].sort();

  assert.deepEqual(
    claimed,
    implemented,
    `these two must be the same set.\n` +
      `  declared native/mixed: ${claimed.join(', ') || '(none)'}\n` +
      `  handlers in server/export/pptx.js: ${implemented.join(', ') || '(none)'}\n\n` +
      `A declaration without a handler rasterises the slide while telling the ` +
      `user it is editable;\na handler without a declaration never runs. ` +
      `Adding a native mapper is two edits, on purpose.`,
  );
});

test('the boot check reports a claim the build cannot honour, by name', () => {
  // Assertion 2 covers the core types in CI. A fork's file-JS types only exist
  // in the registry a running server composed, so the same question is asked
  // once more at boot — against the process-wide registry, which here holds
  // whatever fork fixtures the suite loaded, and must be clean.
  assert.deepEqual(unbackedFidelityClaims(), []);
  assert.deepEqual(
    unbackedFidelityClaims({
      'fork-native-slide': { fidelity: { pptx: 'native' } },
      'fork-mixed-slide': { fidelity: { pptx: 'mixed' } },
      'fork-raster-slide': { fidelity: { pptx: 'raster' } },
      'fork-silent-slide': {},
      'video-slide': SLIDE_TYPES['video-slide'],
    }),
    [
      { type: 'fork-native-slide', claim: 'native' },
      { type: 'fork-mixed-slide', claim: 'mixed' },
    ],
  );
});

// --- assertion 3: no second definition -------------------------------------

/**
 * Files under `server/export/` that may name a slide type, and why.
 *
 * Deliberately an allow-list rather than a threshold: the branch this facet
 * retired was a single name, so a count-based gate would never have seen it.
 * Each entry says which question the module is answering, because that is what
 * distinguishes a legitimate special case from a list waiting to happen.
 */
const NAME_BRANCH_EXEMPTIONS = {
  'server/export/pptx.js':
    'Holds NATIVE_PPTX_HANDLERS, a table keyed by type name — which is where ' +
    'the names belong now. It is guarded harder than a grep could: assertion ' +
    '2 above pins its keys against the declarations, in both directions.',
  'server/export/print.js':
    'A per-type renderer table — a row per type is what it is, not a list a ' +
    'type can fall out of unnoticed. Already accounted for in the branching ' +
    'inventory (tests/helpers/slide-type-name-branching.js).',
  'server/export/pdf-slides.js':
    'Answers a different question: a video slide has no still frame, so the ' +
    'PDF draws a poster instead of a player. That is about rasterising a ' +
    'video, not about which fidelity tier a type gets.',
  'server/export/png-slides.js':
    'Same question as pdf-slides.js, same answer, other raster target.',
};

/**
 * Drop comment lines, so that *writing about* a type is not the same as
 * branching on one. `gradient-raster.js` records a measurement taken on six
 * pages of icon-card-grid; that is documentation of a benchmark, and a guard
 * that forbade it would only teach people to spell the name differently in
 * prose. Whole-line only: a `//` mid-line may live inside a URL.
 *
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

test('the PPTX export dispatches on the facet, not on type names', () => {
  const files = execSync('git ls-files server/export', {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f.endsWith('.js'));

  assert.ok(files.length > 10, `expected the export tree, got ${files.length}`);

  const offenders = [];
  for (const file of files) {
    if (Object.hasOwn(NAME_BRANCH_EXEMPTIONS, file)) continue;
    const src = stripComments(readFileSync(resolve(ROOT, file), 'utf8'));
    const named = CORE_SLIDE_TYPE_NAMES.filter((name) =>
      new RegExp(`['"\`]${name}['"\`]`).test(src),
    );
    if (named.length) offenders.push(`${file}: ${named.join(', ')}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `these export modules name a slide type:\n` +
      offenders.map((o) => `  - ${o}`).join('\n') +
      `\n\nAsk the type instead — exportFidelity(def, target) from ` +
      `shared/slide-types/fidelity.js — or,\nif the module is answering a ` +
      `different question than "how faithfully does this export?",\nadd it to ` +
      `NAME_BRANCH_EXEMPTIONS in this file with the question it IS answering.`,
  );
});
