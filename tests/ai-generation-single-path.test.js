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
 * **No allowlist.** The file and Notion import adapters were the last two
 * with a copy of their own; they run `generateSlides()` now and assemble
 * around it (B757), so every server module is held to the rule.
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
  assert.deepEqual(
    stepImporters(),
    [],
    'run the chain through generateSlides()/generateDeck() in server/utils/ai/generate-deck.js',
  );
});

test('the guard sees the service import the steps', () => {
  const imports = resolvedImports(SERVICE);
  for (const step of STEPS) {
    assert.ok(imports.includes(step), `${rel(SERVICE)} imports ${rel(step)}`);
  }
});
