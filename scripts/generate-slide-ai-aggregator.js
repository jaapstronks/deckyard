#!/usr/bin/env node
// Derive `server/utils/ai/slide-catalog/type-ai.js` — the one place the agent
// catalog reaches for a slide type's editorial copy — from the directories on
// disk.
//
// WHY THIS EXISTS
// A slide type in the directory form owns the hand-written half of its agent
// contract in its own `ai.js` (docs/reference/slide-type-directory.md): when to
// pick this type, when not to. Before this, that copy lived in eight
// category modules under `slide-catalog/`, and which module a type's prose sat
// in was a filing decision nobody could derive from the type. So the import
// list is a build product of the filesystem: a directory with an `ai.js` is in,
// one without is out, and `tests/slide-ai-aggregator.test.js` gates the
// committed file byte-for-byte. Same shape as the authoring and inline-edit
// aggregators.
//
// WHY IT LIVES UNDER server/
// `ai.js` is ~168 KB of prose the browser never executes, and Deckyard has no
// bundler, so any import from a module the browser loads is a file it fetches.
// The boundary rule is that `ai.js` is imported from `server/` only, and
// tests/slide-type-directory-boundary.test.js enforces it by walking the real
// module graph from the render entry. Putting the aggregator in `shared/` would
// be the one import that makes the rule unenforceable, so it lives on the side
// that is allowed to have it.
//
// Run `node scripts/generate-slide-ai-aggregator.js` to regenerate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repo root, for turning the relative paths below into absolute ones. */
export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Where the type directories live. */
export const TYPES_DIR = path.join(REPO_ROOT, 'shared', 'slide-types', 'types');

/** The generated file, repo-relative. */
export const AGGREGATOR_PATH = path.join(
  'server',
  'utils',
  'ai',
  'slide-catalog',
  'type-ai.js'
);

/** Relative path from the aggregator back to the type directories. */
const REL = '../../../../shared/slide-types/types';

/**
 * Type names that ship an `ai.js`, sorted so the output is stable regardless of
 * readdir order.
 * @returns {string[]}
 */
export function typesWithAi() {
  return fs
    .readdirSync(TYPES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(TYPES_DIR, name, 'ai.js')))
    .sort();
}

/**
 * `icon-card-grid-slide` → `iconCardGridSlideAi`.
 * @param {string} name
 * @returns {string}
 */
export function identifierFor(name) {
  const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  return `${camel}Ai`;
}

/** The exact bytes the aggregator should contain. */
export function buildAggregator() {
  const names = typesWithAi();
  const imports = names
    .map((n) => `import { ai as ${identifierFor(n)} } from '${REL}/${n}/ai.js';`)
    .join('\n');
  const entries = names.map((n) => `  '${n}': ${identifierFor(n)},`).join('\n');

  return `// GENERATED FILE — do not edit by hand.
// Run \`node scripts/generate-slide-ai-aggregator.js\` to regenerate.
// Source of truth: the \`ai.js\` in each shared/slide-types/types/<name>/.

${imports}

/**
 * The agent-facing editorial copy per slide type — description, bestFor,
 * notFor, and the per-type extras a few types add (\`allowedIcons\`,
 * \`varietyRule\`) — owned by the type rather than filed into a category module.
 *
 * A type without an entry is withheld from agents, or has not been written up
 * yet; \`agent-catalog.js\` still derives a schema for it and flags it
 * \`documented: false\`, so a miss degrades rather than disappears.
 *
 * **Server-side only.** This is ~168 KB of prose the browser never executes.
 * Never import it, or any type's \`ai.js\`, from \`shared/\` or \`client/\` —
 * tests/slide-type-directory-boundary.test.js walks the real module graph from
 * the render entry and fails on any route into one.
 *
 * @type {Readonly<Record<string, Object>>}
 */
export const SLIDE_TYPE_AI = Object.freeze({
${entries}
});

/**
 * The editorial copy for a type, or null when it has none.
 * @param {string} type - registry type name
 * @returns {Object|null}
 */
export function aiFor(type) {
  return SLIDE_TYPE_AI[type] || null;
}
`;
}

function main() {
  const abs = path.join(REPO_ROOT, AGGREGATOR_PATH);
  const content = buildAggregator();
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  if (current === content) {
    console.log(`${AGGREGATOR_PATH} already up to date.`);
    return;
  }
  fs.writeFileSync(abs, content);
  console.log(`updated ${AGGREGATOR_PATH} (${typesWithAi().length} types)`);
}

// pathToFileURL, not a template literal: the repo path may contain spaces, which
// import.meta.url percent-encodes and a raw `file://${argv[1]}` does not — the
// mismatch would make this script a silent no-op (see scripts/i18n-audit.js).
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
