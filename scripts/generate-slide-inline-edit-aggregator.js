#!/usr/bin/env node
// Derive `shared/slide-types/inline-edit.js` — the one place the editor reaches
// for a slide type's editing companions — from the directories on disk.
//
// WHY THIS EXISTS
// A slide type in the directory form owns its editing companions in its own
// `inline-edit.js` (docs/reference/slide-type-directory.md): the on-canvas
// descriptor and the inspector keep-list. Deckyard has no bundler, so a browser
// consumer cannot scan a directory: it needs a static import per type.
// Hand-maintaining that import list would just move the duplication the A7.1
// track is removing — a second registration list next to `registry.js`,
// drifting the moment a type is added or removed. So the list is a build
// product of the filesystem: a directory with an `inline-edit.js` is in, one
// without is out, and `tests/slide-inline-edit-aggregator.test.js` gates the
// committed file byte-for-byte.
//
// WHY IT IMPORTS NAMESPACES, NOT NAMED EXPORTS
// The file carries two facets now, and the two do not cover the same types: a
// type can own an inspector keep-list without being inline-editable at all
// (custom-html, follow-invite, payoff). Importing `* as <type>` keeps the
// generator a pure directory scan — it never has to know which of the named
// exports a given file happens to have — and the aggregator drops the misses at
// runtime instead. A third facet costs one line here and none in the scan.
//
// WHY IT IS NOT `registry.js`
// Same reason as the authoring aggregator: the registry is what the browser
// loads to *render* a slide, and the presenter renders slides without ever
// offering the editor. Pulling companions in through the registry would put
// editor-only payload on the render path. This is a sibling of the registry,
// never a dependency of it; tests/slide-type-directory-boundary.test.js holds
// that line.
//
// Run `node scripts/generate-slide-inline-edit-aggregator.js` to regenerate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repo root, for turning the relative paths below into absolute ones. */
export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Where the type directories live. */
export const TYPES_DIR = path.join(REPO_ROOT, 'shared', 'slide-types', 'types');

/** The generated file, repo-relative. */
export const AGGREGATOR_PATH = path.join('shared', 'slide-types', 'inline-edit.js');

/**
 * Type names that ship an `inline-edit.js`, sorted so the output is stable
 * regardless of readdir order.
 * @returns {string[]}
 */
export function typesWithInlineEdit() {
  return fs
    .readdirSync(TYPES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(TYPES_DIR, name, 'inline-edit.js')))
    .sort();
}

/**
 * `icon-card-grid-slide` → `iconCardGridSlide`.
 * @param {string} name
 * @returns {string}
 */
export function identifierFor(name) {
  return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** The exact bytes `shared/slide-types/inline-edit.js` should contain. */
export function buildAggregator() {
  const names = typesWithInlineEdit();
  const imports = names
    .map((n) => `import * as ${identifierFor(n)} from './types/${n}/inline-edit.js';`)
    .join('\n');
  const entries = names.map((n) => `  '${n}': ${identifierFor(n)},`).join('\n');

  return `// GENERATED FILE — do not edit by hand.
// Run \`node scripts/generate-slide-inline-edit-aggregator.js\` to regenerate.
// Source of truth: the \`inline-edit.js\` in each shared/slide-types/types/<name>/.

${imports}

/**
 * Type name → the whole \`inline-edit.js\` module, so the maps below can be
 * sliced out of it per facet. A type declares whichever of the named exports it
 * has something to say about, and falls out of the maps for the rest — being
 * absent is a legitimate answer everywhere here.
 *
 * @type {Readonly<Record<string, Record<string, unknown>>>}
 */
const MODULES = Object.freeze({
${entries}
});

/**
 * One named export across every type, with the types that do not declare it
 * dropped rather than mapped to \`undefined\`. Consumers ask "does this type
 * have one", and \`in\`/\`Object.keys\` should answer that honestly.
 *
 * @param {string} exportName
 * @returns {Readonly<Record<string, unknown>>}
 */
function facet(exportName) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(MODULES)
        .filter(([, mod]) => mod[exportName] !== undefined)
        .map(([type, mod]) => [type, mod[exportName]])
    )
  );
}

/**
 * Inline-edit descriptor per slide type: what the editor lets someone change on
 * the canvas, owned by the type rather than restated in one hand-kept map.
 *
 * A type without an entry has no inline editing yet (or a fork type declares
 * \`inline: {}\` on its definition instead) — consumers must treat a miss as
 * "side-form only", never as an error. See docs/reference/slide-type-directory.md.
 *
 * **Editor-side only.** Never import this from \`registry.js\` or a type's
 * \`index.js\`/\`render.js\`: the presenter renders slides without ever offering
 * one, and this is editor payload it must not pay for.
 *
 * @type {Readonly<Record<string, Object>>}
 */
export const SLIDE_TYPE_INLINE_EDIT = facet('inlineEdit');

/**
 * Inspector keep-list per slide type: the field keys the settings pane keeps
 * rendering once the canvas covers the rest of the slide.
 *
 * Sparse by design, and a *narrowing* rather than a listing — a type without an
 * entry gets the safe default (every field the inline layer does not cover), so
 * only a stale entry is a problem. Resolve it through
 * \`slideTypeInspectorKeeps()\` in ./inline-edit-companions.js rather than
 * reading this map: a fork type declares its own on the definition, and this
 * map is core's answer, never the population.
 *
 * @type {Readonly<Record<string, string[]>>}
 */
export const SLIDE_TYPE_INSPECTOR_KEEPS = facet('inspectorKeeps');
`;
}

function main() {
  const abs = path.join(REPO_ROOT, AGGREGATOR_PATH);
  const content = buildAggregator();
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  if (current === content) {
    console.log('shared/slide-types/inline-edit.js already up to date.');
    return;
  }
  fs.writeFileSync(abs, content);
  console.log(`updated ${AGGREGATOR_PATH} (${typesWithInlineEdit().length} types)`);
}

// pathToFileURL, not a template literal: the repo path may contain spaces, which
// import.meta.url percent-encodes and a raw `file://${argv[1]}` does not — the
// mismatch would make this script a silent no-op (see scripts/i18n-audit.js).
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
