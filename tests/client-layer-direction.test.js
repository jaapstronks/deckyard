/**
 * Client layers: `lib/` is a layer, `views/` is a feature (D263, B528).
 *
 * `AGENTS.md` § _Client layers_ states the rule: `client/lib/` holds what owns
 * no product feature (DOM primitives, transport, state and routing,
 * formatting, the theme runtime, the slide pipeline, a DOM-less service layer),
 * and a module that **fetches a feature's records and renders them is a
 * view**, however many pages use it. The verhuislijst of D263 is the judgment;
 * this file pins the two halves of it that can be measured:
 *
 *   1. **Direction.** No import under `client/lib/` resolves into
 *      `client/views/`. A layer that reaches up into a feature is no layer.
 *      Four of these existed when D263 was decided (2026-09-28).
 *   2. **Fetch-and-render.** No module under `client/lib/`, outside `dom/` and
 *      `slide-runtime/`, imports both the `h()` seam (`lib/dom/index.js`) and
 *      a fetch layer (`lib/api.js`, anything under `lib/net/`, or a bare
 *      `fetch(` call). Three of these existed (the slide-library picker, the
 *      collections bar, the organization switcher). `dom/` and
 *      `slide-runtime/` are exempt by D263: they are the DOM and the slide
 *      runtime, and the runtime loads what a slide needs.
 *
 * **No allowlist**, on purpose (the same stance as `module-layout.test.js`):
 * B528 moved everything both counts found, so a new hit is a new module in the
 * wrong place, not a known debt.
 *
 * Run with: node --test tests/client-layer-direction.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const libRoot = path.join(repoRoot, 'client', 'lib');
const viewsRoot = path.join(repoRoot, 'client', 'views');

const DOM_SEAM = path.join(libRoot, 'dom', 'index.js');
const API = path.join(libRoot, 'api.js');
const NET = path.join(libRoot, 'net');
const EXEMPT_FROM_FETCH_AND_RENDER = ['dom', 'slide-runtime'].map((d) =>
  path.join(libRoot, d),
);

/**
 * Every `.js` file under `dir`, absolute.
 * @param {string} dir
 * @returns {string[]}
 */
function jsFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => path.join(e.parentPath, e.name));
}

/**
 * The relative module specifiers a file imports (static, re-export and
 * literal dynamic `import()`), resolved to absolute paths.
 * @param {string} file
 * @param {string} source
 * @returns {string[]}
 */
function resolvedImports(file, source) {
  const re =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
  return [...source.matchAll(re)].map((m) =>
    path.resolve(path.dirname(file), m[1]),
  );
}

/**
 * `source` with block and line comments blanked, so a `fetch(` in a JSDoc
 * example does not count. Strings are left alone; a `//` inside a quoted URL
 * only shortens what follows on that line, which can hide a hit but never
 * invent one.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

const rel = (p) => path.relative(repoRoot, p).split(path.sep).join('/');
const inside = (p, dir) => p.startsWith(dir + path.sep);

const libModules = jsFiles(libRoot).map((file) => {
  const source = fs.readFileSync(file, 'utf8');
  return { file, source, imports: resolvedImports(file, source) };
});

test('the scan sees client/lib/', () => {
  assert.ok(
    libModules.length > 50,
    `expected the client/lib/ walk to find modules, found ${libModules.length}`,
  );
});

test('no import under client/lib/ lands in client/views/ (D263)', () => {
  const offenders = libModules.flatMap(({ file, imports }) =>
    imports
      .filter((target) => inside(target, viewsRoot))
      .map((target) => `${rel(file)} -> ${rel(target)}`),
  );

  assert.deepEqual(
    offenders,
    [],
    `client/lib/ is a layer and never imports a feature. Move the importing ` +
      `module to client/views/ (one owner: inside that view; two or more: ` +
      `views/<feature>/ with an index.js seam) - AGENTS.md § Client layers:\n  ` +
      offenders.join('\n  '),
  );
});

test('no module under client/lib/ both fetches and renders (D263)', () => {
  const offenders = libModules
    .filter(
      ({ file }) =>
        !EXEMPT_FROM_FETCH_AND_RENDER.some((dir) => inside(file, dir)),
    )
    .filter(({ imports }) => imports.includes(DOM_SEAM))
    .filter(
      ({ source, imports }) =>
        imports.some((t) => t === API || inside(t, NET)) ||
        /(?<![\w$.])(?:window\.|globalThis\.)?fetch\s*\(/.test(
          stripComments(source),
        ),
    )
    .map(({ file }) => rel(file));

  assert.deepEqual(
    offenders,
    [],
    `A module that fetches a feature's records and renders them is a view, ` +
      `however many pages use it. Move it to client/views/ - AGENTS.md § ` +
      `Client layers:\n  ` +
      offenders.join('\n  '),
  );
});
