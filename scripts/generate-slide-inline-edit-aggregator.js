#!/usr/bin/env node
// Derive `shared/slide-types/inline-edit.js` — the one place the editor reaches
// for a slide type's inline-edit descriptor — from the directories on disk.
//
// WHY THIS EXISTS
// A slide type in the directory form owns its on-canvas editing descriptor in
// its own `inline-edit.js` (docs/reference/slide-type-directory.md). Deckyard
// has no bundler, so a browser consumer cannot scan a directory: it needs a
// static import per type. Hand-maintaining that import list would just move the
// duplication the A7.1 track is removing — a second registration list next to
// `registry.js`, drifting the moment a type is added or removed. So the list is
// a build product of the filesystem: a directory with an `inline-edit.js` is in,
// one without is out, and `tests/slide-inline-edit-aggregator.test.js` gates the
// committed file byte-for-byte.
//
// WHY IT IS NOT `registry.js`
// Same reason as the authoring aggregator: the registry is what the browser
// loads to *render* a slide, and the presenter renders slides without ever
// offering the editor. Pulling descriptors in through the registry would put
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
 * `icon-card-grid-slide` → `iconCardGridSlideInlineEdit`.
 * @param {string} name
 * @returns {string}
 */
export function identifierFor(name) {
  const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  return `${camel}InlineEdit`;
}

/** The exact bytes `shared/slide-types/inline-edit.js` should contain. */
export function buildAggregator() {
  const names = typesWithInlineEdit();
  const imports = names
    .map((n) => `import { inlineEdit as ${identifierFor(n)} } from './types/${n}/inline-edit.js';`)
    .join('\n');
  const entries = names.map((n) => `  '${n}': ${identifierFor(n)},`).join('\n');

  return `// GENERATED FILE — do not edit by hand.
// Run \`node scripts/generate-slide-inline-edit-aggregator.js\` to regenerate.
// Source of truth: the \`inline-edit.js\` in each shared/slide-types/types/<name>/.

${imports}

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
 * @type {Record<string, Object>}
 */
export const SLIDE_TYPE_INLINE_EDIT = {
${entries}
};

/**
 * The inline-edit descriptor for a type, or null when it has none.
 * @param {string} type - registry type name
 * @returns {Object|null}
 */
export function inlineEditFor(type) {
  return SLIDE_TYPE_INLINE_EDIT[type] || null;
}
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
