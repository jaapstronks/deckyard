/**
 * One generation pipeline: only the service runs the model phases (B756).
 *
 * The outline → revise → refine chain was written out four times (file
 * import, Notion import, the wizard stream, MCP), and each copy dropped
 * something the others carried: theme context, the revise step, presenter
 * notes, a title-slide key the type declares. `server/utils/ai/generate-deck.js`
 * is the one place it runs now (`generateSlides`, `assembleDeck`,
 * `generateDeck`); a route or tool passes its options and hooks.
 *
 * This pins it: no module under `server/` other than the service imports
 * `generate-outline.js`, `refine-slides.js` or `revise-outline.js` (static,
 * re-export or literal dynamic import). Tests and the AI test suite may drive
 * the steps directly; they are not server modules.
 *
 * **No allowlist.** The two import adapters that still carry their own copy
 * move onto the service in the next PR (B757), and stand below as the named
 * rest that PR deletes: the
 * test fails as soon as one of them no longer imports a step, so the rest
 * cannot outlive its removal.
 *
 * Run with: node --test tests/ai-generation-single-path.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';
import { walkFiles } from './helpers/walk-files.js';

await init;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const serverRoot = path.join(repoRoot, 'server');
const aiRoot = path.join(serverRoot, 'utils', 'ai');

const SERVICE = path.join(aiRoot, 'generate-deck.js');
const STEPS = new Set(
  ['generate-outline.js', 'refine-slides.js', 'revise-outline.js'].map((f) =>
    path.join(aiRoot, f),
  ),
);

/**
 * The file and Notion imports still run their own chain until the next PR
 * moves them onto `generateSlides()` and deletes this set (B757).
 */
const IMPORT_ADAPTER_REST = new Set([
  'server/utils/convert-file/ai-convert.js',
  'server/utils/convert-notion.js',
]);

const rel = (p) => path.relative(repoRoot, p).split(path.sep).join('/');

/** The relative specifiers a file imports, resolved to absolute paths. */
function resolvedImports(file) {
  const [imports] = parse(fs.readFileSync(file, 'utf8'));
  return imports
    .filter(
      ({ specifier }) =>
        specifier?.startsWith('./') || specifier?.startsWith('../'),
    )
    .map(({ specifier }) => path.resolve(path.dirname(file), specifier));
}

/** Server modules (other than the service and the steps) importing a step. */
function stepImporters() {
  return walkFiles(serverRoot, {
    extensions: ['.js'],
    skipDirs: ['node_modules'],
  })
    .filter((file) => file !== SERVICE && !STEPS.has(file))
    .filter((file) => resolvedImports(file).some((t) => STEPS.has(t)))
    .map(rel)
    .sort();
}

test('only the generation service imports the outline, refine and revise steps', () => {
  const offenders = stepImporters().filter((f) => !IMPORT_ADAPTER_REST.has(f));
  assert.deepEqual(
    offenders,
    [],
    'run the chain through generateSlides()/generateDeck() in server/utils/ai/generate-deck.js',
  );
});

test('the import adapter rest still has its own chain (delete the entry once it does not)', () => {
  const importers = new Set(stepImporters());
  for (const file of IMPORT_ADAPTER_REST) {
    assert.ok(
      importers.has(file),
      `${file} no longer imports a step: remove it from IMPORT_ADAPTER_REST`,
    );
  }
});

test('the guard sees the service import the steps', () => {
  const imports = resolvedImports(SERVICE);
  for (const step of STEPS) {
    assert.ok(imports.includes(step), `${rel(SERVICE)} imports ${rel(step)}`);
  }
});
