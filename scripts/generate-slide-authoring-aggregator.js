#!/usr/bin/env node
// Derive `shared/slide-types/authoring.js` — the one place the editor reaches
// for a slide type's author-facing companions — from the directories on disk.
//
// WHY THIS EXISTS
// A slide type in the directory form owns its picker copy, glyph and sample
// content in its own `authoring.js` (docs/reference/slide-type-directory.md).
// Deckyard has no bundler, so a browser consumer cannot scan a directory: it
// needs a static import per type. Hand-maintaining that import list would just
// move the duplication the A7.1 track is removing — a second registration list
// next to `registry.js`, drifting the moment a type is added or removed. So the
// list is a build product of the filesystem: a directory with an `authoring.js`
// is in, one without is out, and `tests/slide-authoring-aggregator.test.js`
// gates the committed file byte-for-byte.
//
// WHY IT IS NOT `registry.js`
// The registry is what the browser loads to *render* a slide, and the presenter
// renders slides without ever offering one. Pulling authoring copy in through
// the registry would put picker prose in the presenter's payload — the same
// reason `ai.js` is server-only. The aggregator is a sibling of the registry,
// never a dependency of it; tests/slide-type-directory-boundary.test.js holds
// that line.
//
// Run `node scripts/generate-slide-authoring-aggregator.js` to regenerate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { formatGenerated } from './lib/format-generated.js';

/** Repo root, for turning the relative paths below into absolute ones. */
export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Where the type directories live. */
export const TYPES_DIR = path.join(REPO_ROOT, 'shared', 'slide-types', 'types');

/** The generated file, repo-relative. */
export const AGGREGATOR_PATH = path.join(
  'shared',
  'slide-types',
  'authoring.js',
);

/**
 * Type names that ship an `authoring.js`, sorted so the output is stable
 * regardless of readdir order.
 * @returns {string[]}
 */
export function typesWithAuthoring() {
  return fs
    .readdirSync(TYPES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(TYPES_DIR, name, 'authoring.js')))
    .sort();
}

/**
 * `icon-card-grid-slide` → `iconCardGridSlideAuthoring`.
 * @param {string} name
 * @returns {string}
 */
export function identifierFor(name) {
  const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  return `${camel}Authoring`;
}

/**
 * The exact bytes the aggregator should contain — Prettier-formatted with
 * the repo config, so `npm run format` and this generator agree (one spelling;
 * see scripts/lib/format-generated.js).
 */
export async function buildAggregator() {
  const names = typesWithAuthoring();
  const imports = names
    .map((n) => `import ${identifierFor(n)} from './types/${n}/authoring.js';`)
    .join('\n');
  const entries = names.map((n) => `  '${n}': ${identifierFor(n)},`).join('\n');

  const raw = `// GENERATED FILE — do not edit by hand.
// Run \`node scripts/generate-slide-authoring-aggregator.js\` to regenerate.
// Source of truth: the \`authoring.js\` in each shared/slide-types/types/<name>/.

${imports}

/**
 * Author-facing companions per slide type: the picker's glyph, copy and sample
 * content, owned by the type rather than restated in each editor surface.
 *
 * A type without an entry has not moved its companions into the directory form
 * yet (or has none to move) — consumers must treat a miss as "fall back", never
 * as an error. See docs/reference/slide-type-directory.md.
 *
 * **Editor-side only.** Never import this from \`registry.js\` or a type's
 * \`index.js\`/\`render.js\`: the presenter renders slides without ever offering
 * one, and this is picker payload it must not pay for.
 *
 * @type {Record<string, Object>}
 */
export const SLIDE_TYPE_AUTHORING = {
${entries}
};
`;
  return formatGenerated(AGGREGATOR_PATH, raw);
}

async function main() {
  const abs = path.join(REPO_ROOT, AGGREGATOR_PATH);
  const content = await buildAggregator();
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  if (current === content) {
    console.log('shared/slide-types/authoring.js already up to date.');
    return;
  }
  fs.writeFileSync(abs, content);
  console.log(
    `updated ${AGGREGATOR_PATH} (${typesWithAuthoring().length} types)`,
  );
}

// pathToFileURL, not a template literal: the repo path may contain spaces,
// which import.meta.url percent-encodes and a raw `file://${argv[1]}` does not
// — the mismatch would make this script a silent no-op (see scripts/i18n-audit.js).
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
