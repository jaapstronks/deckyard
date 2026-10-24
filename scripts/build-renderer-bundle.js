#!/usr/bin/env node
/**
 * Build a render bundle: freeze a renderer so a published edition can keep
 * rendering the way it rendered on its publication day.
 *
 * Building is an **operator** action, which is why this lives with the other
 * build tooling rather than in `server/`: it walks a checkout, refuses what it
 * cannot close, and writes a verified directory into a store. Nothing in the
 * request path builds, opens or executes a bundle
 * (`server/render/renderer-bundle/`).
 *
 * What goes in, and why each set is declared rather than guessed:
 *
 *   1. **The module closure** of the render worker: every relative import it
 *      reaches, statically or through a literal `import()`. This is the
 *      renderer's code.
 *   2. **Files the closure reads at run time** through a
 *      `new URL('…', import.meta.url)` literal: the client modules the script
 *      chain inlines, the one accessibility rule the reader borrows. Scanning
 *      for the literal rather than listing them means a module that starts
 *      reading a new file does not silently leave it out of the bundle.
 *   3. **The CSS closure** of the two entry stylesheets, resolved with the same
 *      `@import` walker the render path itself uses
 *      (`cssImportClosure()`), so the files carried are exactly the files read.
 *   4. **The highlighter bytes** (`client/vendor/prism`, `client/vendor/katex`).
 *      A published edition *links* these rather than inlining them, so they are
 *      read by the reader's browser and not by this renderer - but they decide
 *      what a code block and a formula look like, so they are part of the
 *      frozen contract and are hashed with the rest. Serving them from the
 *      edition rather than from the current installation is T1.4's half.
 *   5. **The fork CSS seam** (`custom/styles/`), because a fork's stylesheet
 *      can restyle every slide and is therefore renderer input.
 *
 * What stays out: fonts and images (bytes of the *edition*, frozen in its
 * input), `node_modules` (nothing in the closure imports a package), and
 * anything that reads a current value.
 *
 * The scan rejects forbidden imports and literal file reads. It is a dependency
 * inventory, not a capability proof: global APIs can bypass import resolution.
 * Runtime isolation requires a boundary outside Node. A *dynamic* npm import
 * in a branch the renderer never takes is recorded as an unsealed edge, and
 * only the edges in `ACCEPTED_UNSEALED` are allowed to be there at all.
 *
 * Usage:
 *   node scripts/build-renderer-bundle.js --store <dir> [--source <checkout>]
 *   node scripts/build-renderer-bundle.js --store <dir> --print-map
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import { init, parse } from 'es-module-lexer';

import { cssImportClosure } from '../server/utils/read-css-with-imports.js';
import {
  RENDERER_BUNDLE_SCHEMA,
  canonicalManifestBytes,
  rendererHashFor,
} from '../server/render/renderer-bundle/manifest.js';

const defaultSourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** The worker is the bundle's process entry; the render entry hangs off it. */
export const WORKER_ENTRY = 'server/render/renderer-bundle/bundle/worker.js';
/** The render entry, named in the manifest so a reader need not infer it. */
export const RENDER_ENTRY = 'server/render/renderer-bundle/bundle/entry.js';

/** The fork slide-type directory `shared/slide-types/custom-loader.js` scans. */
const FORK_TYPES_DIR = 'custom/slide-types';

/** Entry stylesheets whose `@import` closure the bundle carries. */
const CSS_ENTRIES = Object.freeze([
  'client/styles/export.css',
  'client/styles/slides.css',
]);

/** Directories copied whole when present. */
const STATIC_TREES = Object.freeze([
  'client/vendor/prism',
  'client/vendor/katex',
  'custom/styles',
  FORK_TYPES_DIR,
]);

/**
 * The fork's slide types. Carried whole, and walked as closure entries on top
 * of that: a fork type is renderer code, so its own imports have to be in the
 * bundle as well, or the frozen renderer would reach for a module that is not
 * there.
 */
const FORK_TYPES_DIR_FILES = (sourceRoot) =>
  treeFiles(path.join(sourceRoot, FORK_TYPES_DIR)).then((files) =>
    files.filter((f) => f.endsWith('.js') && !path.basename(f).startsWith('_')),
  );

/**
 * Builtins a sealed renderer may use: reading files and computing. Anything
 * outside this set is refused, so a new capability has to be argued for here
 * rather than appearing in a closure.
 */
const ALLOWED_BUILTINS = Object.freeze(
  new Set([
    'node:assert',
    'node:buffer',
    'node:crypto',
    'node:fs',
    'node:fs/promises',
    'node:module',
    'node:path',
    'node:process',
    'node:url',
    'node:util',
  ]),
);

/**
 * Capabilities that make a renderer unfrozen, with the reason the refusal
 * states. Bare spellings included: `require('net')` and `node:net` are the same
 * socket.
 */
const SEALED_CAPABILITIES = Object.freeze({
  net: 'network',
  tls: 'network',
  dns: 'network',
  'dns/promises': 'network',
  http: 'network',
  https: 'network',
  http2: 'network',
  dgram: 'network',
  inspector: 'process',
  child_process: 'process',
  cluster: 'process',
  worker_threads: 'process',
  pg: 'database',
  kysely: 'database',
  ioredis: 'database',
  undici: 'network',
  'node-fetch': 'network',
});

/**
 * Dynamic npm imports the bundle is allowed to carry without the package,
 * each with why it never fires inside a sealed render.
 *
 * This is not a convenience allowlist: it is the honest record of the one edge
 * T1.1 did not close. `shared/sanitize.js` loads `jsdom`/`dompurify` from
 * `initSanitizer()`, which only the server and the MCP entrypoint call. A
 * sealed worker never calls it, and the render entry refuses an edition whose
 * slides carry author markup, so the branch is unreachable rather than merely
 * untaken. See `docs/reference/renderer-bundle.md` § Dependency map.
 */
const ACCEPTED_UNSEALED = Object.freeze({
  jsdom:
    'HTML sanitizer backend, loaded only by initSanitizer(); the render entry refuses editions with author markup',
  dompurify:
    'HTML sanitizer, loaded only by initSanitizer(); the render entry refuses editions with author markup',
});

/**
 * Modules whose dynamic `import()` has a computed specifier that the bundle
 * closes anyway, because the only thing it can reach is a directory the bundle
 * carries whole.
 *
 * `custom-loader.js` imports every `.js` file directly inside
 * `custom/slide-types/`, which `STATIC_TREES` freezes and whose own imports are
 * walked as closure entries. Without this entry the scan would refuse every
 * bundle; with a looser rule (ignore computed imports) it would accept a
 * renderer that loads code from anywhere.
 */
const ACCEPTED_DIRECTORY_LOADERS = Object.freeze({
  'shared/slide-types/custom-loader.js':
    'imports each .js file in custom/slide-types/, which the bundle carries whole',
});

/** A refusal from the scan: a list of reasons, not the first one found. */
export class RendererBundleBuildError extends Error {
  constructor(reasons) {
    super(
      `render bundle refused:\n  - ${reasons.join('\n  - ')}\n` +
        'A render bundle that can reach outside itself is not frozen; close ' +
        'the dependency or move it into the edition input (T1.2).',
    );
    this.name = 'RendererBundleBuildError';
    this.reasons = reasons;
  }
}

const toPosix = (p) => p.split(path.sep).join('/');

/** `source` with comments blanked, so a specifier in a docblock does not count. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

/** Resolve a relative specifier the way Node would for an ESM file. */
function resolveRelative(specifier, fromFile) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  if (existsSync(base)) return base;
  for (const candidate of [`${base}.js`, path.join(base, 'index.js')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Walk the module closure of one or more entries.
 *
 * @param {string} sourceRoot - Checkout the closure must stay inside
 * @param {string[]} [entries] - Source-relative entry modules
 * @returns {Promise<{files: string[], runtimeRefs: string[], unsealed: object[], reasons: string[]}>}
 */
export async function scanClosure(sourceRoot, entries = [WORKER_ENTRY]) {
  await init;
  const files = new Set();
  const runtimeRefs = new Set();
  const unsealed = [];
  const reasons = [];

  const walk = (abs) => {
    if (files.has(abs)) return;
    files.add(abs);
    const rel = toPosix(path.relative(sourceRoot, abs));
    const raw = readFileSync(abs, 'utf8');
    const [imports] = parse(raw, rel);

    for (const im of imports) {
      if (im.type === 'import-meta') continue;
      const kind = im.type === 'dynamic' ? 'dynamic' : 'static';
      const specifier = im.specifier;
      // A computed `import()` cannot be followed, so it can only be frozen
      // when the directory it reads is frozen whole. The lexer reports a bare
      // expression as no specifier at all and a template literal as the string
      // with `*` in place of the expression; both are computed.
      if (!specifier || specifier.includes('*')) {
        if (!Object.hasOwn(ACCEPTED_DIRECTORY_LOADERS, rel)) {
          reasons.push(
            `${rel} has a non-literal dynamic import (${specifier || 'computed specifier'}), so its target cannot be frozen`,
          );
        }
        continue;
      }
      if (specifier.startsWith('.')) {
        const target = resolveRelative(specifier, abs);
        if (!target) {
          reasons.push(`${rel} imports ${specifier}, which does not resolve`);
          continue;
        }
        if (toPosix(path.relative(sourceRoot, target)).startsWith('..')) {
          reasons.push(`${rel} imports ${specifier}, outside the checkout`);
          continue;
        }
        walk(target);
        continue;
      }

      const bare = specifier.replace(/^node:/, '');
      const capability = SEALED_CAPABILITIES[bare];
      if (capability) {
        reasons.push(
          `${rel} imports ${specifier} (${kind}) - ${capability} access is sealed`,
        );
        continue;
      }
      if (specifier.startsWith('node:')) {
        if (!ALLOWED_BUILTINS.has(specifier)) {
          reasons.push(
            `${rel} imports ${specifier} (${kind}), which is not an allowed builtin`,
          );
        }
        continue;
      }
      // An npm package: the bundle carries no node_modules, so a static import
      // would not even load.
      if (kind === 'static') {
        reasons.push(
          `${rel} statically imports the package ${specifier}; a render bundle carries no node_modules`,
        );
        continue;
      }
      if (!Object.hasOwn(ACCEPTED_UNSEALED, specifier)) {
        reasons.push(
          `${rel} dynamically imports the package ${specifier}, which is not an accepted unsealed edge`,
        );
        continue;
      }
      unsealed.push({ specifier, importer: rel, kind });
    }

    for (const match of stripComments(raw).matchAll(
      /new URL\(\s*['"`]([^'"`]+)['"`]\s*,\s*import\.meta\.url\s*,?\s*\)/g,
    )) {
      const target = path.resolve(path.dirname(abs), match[1]);
      const targetRel = toPosix(path.relative(sourceRoot, target));
      if (targetRel.startsWith('..')) {
        reasons.push(`${rel} reads ${match[1]}, outside the checkout`);
        continue;
      }
      if (!existsSync(target)) {
        reasons.push(`${rel} reads ${match[1]}, which does not exist`);
        continue;
      }
      // A module in the closure is already carried as code.
      if (!files.has(target)) runtimeRefs.add(target);
    }
  };

  for (const entry of entries) {
    const abs = path.join(sourceRoot, entry);
    if (!existsSync(abs)) {
      reasons.push(`entry ${entry} does not exist`);
      continue;
    }
    walk(abs);
  }

  return {
    files: [...files].sort(),
    runtimeRefs: [...runtimeRefs].sort(),
    unsealed,
    reasons,
  };
}

/** Every file under `dir`, recursively, as absolute paths. */
async function treeFiles(dir) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else out.push(abs);
    }
  }
  await walk(dir);
  return out.sort();
}

/**
 * Collect every file a bundle carries, grouped by why it is in there.
 *
 * @param {string} sourceRoot
 * @returns {Promise<{groups: Record<string, string[]>, unsealed: object[], reasons: string[]}>}
 */
export async function collectBundleFiles(sourceRoot) {
  const forkTypes = await FORK_TYPES_DIR_FILES(sourceRoot);
  const closure = await scanClosure(sourceRoot, [
    WORKER_ENTRY,
    ...forkTypes.map((f) => toPosix(path.relative(sourceRoot, f))),
  ]);
  const reasons = [...closure.reasons];

  const css = new Set();
  for (const entry of CSS_ENTRIES) {
    const abs = path.join(sourceRoot, entry);
    if (!existsSync(abs)) {
      reasons.push(`entry stylesheet ${entry} is missing`);
      continue;
    }
    for (const file of await cssImportClosure(sourceRoot, abs)) css.add(file);
  }

  const trees = new Set();
  for (const tree of STATIC_TREES) {
    for (const file of await treeFiles(path.join(sourceRoot, tree)))
      trees.add(file);
  }

  return {
    groups: {
      modules: closure.files,
      'runtime-reads': closure.runtimeRefs,
      css: [...css].sort(),
      'static-trees': [...trees].sort(),
    },
    unsealed: closure.unsealed,
    reasons,
  };
}

/** The checkout's commit, for provenance. Null outside a git checkout. */
function sourceCommit(sourceRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sourceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Build a bundle into a store.
 *
 * @param {object} options
 * @param {string} options.storeDir - Directory bundles live in
 * @param {string} [options.sourceRoot] - Checkout to freeze
 * @returns {Promise<{rendererHash: string, dir: string, manifest: object, groups: Record<string, string[]>}>}
 * @throws {RendererBundleBuildError} When the closure cannot be closed
 */
export async function buildRendererBundle({
  storeDir,
  sourceRoot = defaultSourceRoot,
}) {
  const root = path.resolve(sourceRoot);
  const { groups, unsealed, reasons } = await collectBundleFiles(root);
  if (reasons.length) throw new RendererBundleBuildError(reasons);

  const byPath = new Map();
  for (const group of Object.values(groups)) {
    for (const abs of group) {
      const rel = toPosix(path.relative(root, abs));
      if (!byPath.has(rel)) byPath.set(rel, abs);
    }
  }

  const files = [];
  const contents = new Map();
  for (const [rel, abs] of [...byPath].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const bytes = await readFile(abs);
    contents.set(rel, bytes);
    files.push({
      path: rel,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    });
  }

  const manifest = {
    schema: RENDERER_BUNDLE_SCHEMA,
    entry: RENDER_ENTRY,
    worker: WORKER_ENTRY,
    files,
    unsealed,
  };
  const { rendererHash, bytes: manifestBytes } = rendererHashFor(manifest);

  const dir = path.join(path.resolve(storeDir), rendererHash);
  for (const [rel, bytes] of contents) {
    const target = path.join(dir, 'files', rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(path.join(dir, 'manifest.json'), manifestBytes);
  await writeFile(
    path.join(dir, 'provenance.json'),
    `${JSON.stringify(
      {
        rendererHash,
        sourceCommit: sourceCommit(root),
        builtAt: new Date().toISOString(),
        node: process.version,
        groups: Object.fromEntries(
          Object.entries(groups).map(([k, v]) => [k, v.length]),
        ),
      },
      null,
      2,
    )}\n`,
  );

  return {
    rendererHash,
    dir,
    manifest: JSON.parse(canonicalManifestBytes(manifest).toString('utf8')),
    groups,
  };
}

/**
 * The dependency map, as the reference doc reports it: what the renderer
 * reaches and which capabilities it does not.
 *
 * @param {string} [sourceRoot]
 * @returns {Promise<object>}
 */
export async function rendererDependencyMap(sourceRoot = defaultSourceRoot) {
  const root = path.resolve(sourceRoot);
  const { groups, unsealed, reasons } = await collectBundleFiles(root);
  const rel = (abs) => toPosix(path.relative(root, abs));
  const byTopLevel = {};
  for (const abs of groups.modules) {
    const top = rel(abs).split('/').slice(0, 2).join('/');
    byTopLevel[top] = (byTopLevel[top] || 0) + 1;
  }
  return {
    counts: Object.fromEntries(
      Object.entries(groups).map(([k, v]) => [k, v.length]),
    ),
    modulesByArea: Object.fromEntries(
      Object.entries(byTopLevel).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    runtimeReads: groups['runtime-reads'].map(rel),
    unsealed,
    refusals: reasons,
    acceptedUnsealed: ACCEPTED_UNSEALED,
    sealedCapabilities: SEALED_CAPABILITIES,
  };
}

async function main(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args.set(key, true);
    else {
      args.set(key, next);
      i += 1;
    }
  }
  const sourceRoot = args.get('source') || defaultSourceRoot;
  if (args.get('print-map')) {
    console.log(
      JSON.stringify(await rendererDependencyMap(sourceRoot), null, 2),
    );
    return;
  }
  const storeDir = args.get('store');
  if (!storeDir || storeDir === true) {
    console.error(
      'usage: node scripts/build-renderer-bundle.js --store <dir> [--source <checkout>] | --print-map',
    );
    process.exitCode = 1;
    return;
  }
  const built = await buildRendererBundle({ storeDir, sourceRoot });
  console.log(built.rendererHash);
  console.error(
    `${built.manifest.files.length} files in ${built.dir}\n` +
      Object.entries(built.groups)
        .map(([k, v]) => `  ${k}: ${v.length}`)
        .join('\n'),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main(process.argv.slice(2));
}
