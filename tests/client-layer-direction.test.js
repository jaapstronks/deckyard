/**
 * Client layers: `lib/` is a layer, `views/` is a feature (D263, B528).
 *
 * `AGENTS.md` § _Client layers_ states the rule: `client/lib/` holds what owns
 * no product feature (DOM primitives, transport, state and routing,
 * formatting, the theme runtime, the slide pipeline, a DOM-less service layer),
 * and a module that **fetches a feature's records and renders them is a
 * view**, however many pages use it. The verhuislijst of D263 is the judgment;
 * this file pins the layer rules and the feature boundaries already closed:
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
 *   3. **Comments seam.** Editor and viewer consumers import comments through
 *      `views/comments/index.js`. Comment concerns live in that feature, with
 *      no retired editor paths.
 *   4. **Tags seam.** Tag editor consumers use views/tags/index.js; the old
 *      list address is removed. Other feature seams remain separate work.
 *
 * **No allowlist**, on purpose (the same stance as `module-layout.test.js`):
 * everything the layer counts found was moved when the rule landed (B528), so a new
 * hit is a new module in the wrong place, not a known debt.
 *
 * Run with: node --test tests/client-layer-direction.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';

await init;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const libRoot = path.join(repoRoot, 'client', 'lib');
const viewsRoot = path.join(repoRoot, 'client', 'views');

const DOM_SEAM = path.join(libRoot, 'dom', 'index.js');
const API = path.join(libRoot, 'api.js');
const NET = path.join(libRoot, 'net');
const LIB_LAYERS = new Set([
  'dom',
  'net',
  'state',
  'format',
  'theme',
  'slide-runtime',
  'slide-authoring',
  'qa',
]);
const LIB_ROOT_MODULES = new Set([
  'api.js',
  'storage.js',
  'ui-i18n.js',
  'permission-labels.js',
]);
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
  const [imports] = parse(source);
  return imports
    .filter(({ n }) => n?.startsWith('./') || n?.startsWith('../'))
    .map(({ n }) => path.resolve(path.dirname(file), n));
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

const commentsRoot = path.join(viewsRoot, 'comments');
const tagsRoot = path.join(viewsRoot, 'tags');

/** Imports from outside a feature into its implementation. */
function featureSeamViolations(file, source, featureRoot) {
  if (inside(file, featureRoot)) return [];
  const seam = path.join(featureRoot, 'index.js');
  return resolvedImports(file, source).filter(
    (target) => inside(target, featureRoot) && target !== seam,
  );
}

for (const featureRoot of [commentsRoot, tagsRoot]) {
  const feature = path.basename(featureRoot);
  test(`${feature} consumers use the public feature seam`, () => {
    const offenders = jsFiles(path.join(repoRoot, 'client'))
      .filter((file) => !inside(file, path.join(repoRoot, 'client/vendor')))
      .flatMap((file) =>
        featureSeamViolations(
          file,
          fs.readFileSync(file, 'utf8'),
          featureRoot,
        ).map((target) => `${rel(file)} -> ${rel(target)}`),
      );
    assert.deepEqual(
      offenders,
      [],
      `Import ${feature} through views/${feature}/index.js`,
    );
  });
}

test('tag editor has no retired list address', () => {
  assert.equal(
    fs.existsSync(path.join(viewsRoot, 'list', 'tag-editor.js')),
    false,
  );
});

test('comment modules have no retired editor address', () => {
  const retired = fs
    .readdirSync(path.join(viewsRoot, 'editor'))
    .filter((name) => /^comments?-.*\.js$/.test(name));
  assert.deepEqual(retired, [], 'Comment modules belong to views/comments/');
});

for (const featureRoot of [commentsRoot, tagsRoot]) {
  const feature = path.basename(featureRoot);
  test(`the ${feature} seam guard sees module imports and ignores examples`, () => {
    const consumer = path.join(viewsRoot, 'viewer', 'probe.js');
    for (const source of [
      `import { factory } from '../${feature}/concern.js';`,
      `export { factory } from '../${feature}/concern.js';`,
      `import('../${feature}/concern.js');`,
    ]) {
      assert.equal(
        featureSeamViolations(consumer, source, featureRoot).length,
        1,
        source,
      );
    }
    for (const source of [
      `import { factory } from '../${feature}/index.js';`,
      `// import { factory } from '../${feature}/concern.js';`,
      `const example = "import('../${feature}/concern.js')";`,
    ]) {
      assert.deepEqual(
        featureSeamViolations(consumer, source, featureRoot),
        [],
        source,
      );
    }
    assert.deepEqual(
      featureSeamViolations(
        path.join(featureRoot, 'component.js'),
        "import { helper } from './concern.js';",
        featureRoot,
      ),
      [],
    );
  });
}

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

test('client/lib contains only the documented layers and root seams (B672)', () => {
  const entries = fs.readdirSync(libRoot, { withFileTypes: true });
  const unexpected = entries
    .filter((entry) =>
      entry.isDirectory()
        ? !LIB_LAYERS.has(entry.name)
        : !entry.isFile() || !LIB_ROOT_MODULES.has(entry.name),
    )
    .map((entry) => entry.name);
  assert.deepEqual(
    unexpected,
    [],
    'Add a layer to AGENTS.md only after deciding its ownership',
  );
});

test('client/views has no loose view modules (B672)', () => {
  const loose = fs
    .readdirSync(viewsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name);
  assert.deepEqual(loose, []);
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
