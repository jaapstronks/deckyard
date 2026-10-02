import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CORE_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';
import {
  FOUNDATION_CSS,
  ROOT_AGGREGATOR,
  TIERS,
  TYPE_CSS,
  SHARED_CSS,
  typeCssEntries,
  cascadeOrder,
  tierEntries,
  buildAllAggregators,
  aggregatorAbsPath,
  REPO_ROOT,
  VIEWER_LAYER,
  viewerEntries,
  APP_FEATURE_LAYER,
} from '../scripts/generate-slide-css-aggregators.js';

/**
 * The `@import` aggregators under client/styles/slides/ are derived from the
 * manifest in scripts/generate-slide-css-aggregators.js, not hand-maintained.
 * These tests are the gate that keeps the two honest — and, crucially, that the
 * derivation preserves cascade order (the numeric prefixes are cascade order,
 * not a sort key; see the script header).
 */

test('every committed aggregator is byte-identical to the generated output', async () => {
  for (const [rel, expected] of await buildAllAggregators()) {
    const actual = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.equal(
      actual,
      expected,
      `${rel} is out of date — run \`node scripts/generate-slide-css-aggregators.js\``,
    );
  }
});

test('slides.css is a build product too: the foundation, then the tiers, in order', async () => {
  const rel = path.join('client', 'styles', ROOT_AGGREGATOR);
  const generated = (await buildAllAggregators()).get(rel);
  assert.ok(generated, 'slides.css is part of the generated set');
  const imports = [
    ...generated.matchAll(/@import url\('\.\/slides\/([^']+)'\);/g),
  ].map((m) => m[1]);
  assert.deepEqual(imports, [
    ...FOUNDATION_CSS,
    ...TIERS.map((t) => t.aggregator),
  ]);
});

test('the theme layer loads directly after the tokens it binds to (D268)', () => {
  // `00-theme.css` turns a theme's `--t-*` into the slide-local variables the
  // tiers read. It sits behind `00-tokens.css` and before anything else, and
  // nowhere else: slides.css is its only address (no loose <link>, no second
  // read in an export bundler).
  const tokens = FOUNDATION_CSS.indexOf('00-tokens.css');
  const theme = FOUNDATION_CSS.indexOf('00-theme.css');
  assert.equal(tokens, 0, 'tokens first');
  assert.equal(theme, 1, 'the theme layer directly after the tokens');
  const foundationOnDisk = fs
    .readdirSync(path.join(REPO_ROOT, 'client', 'styles', 'slides'))
    .filter((f) => f.endsWith('.css') && !TIERS.some((t) => t.aggregator === f))
    .sort();
  assert.deepEqual(
    [...FOUNDATION_CSS].sort(),
    foundationOnDisk,
    'every foundation sheet on disk is declared, and nothing else is',
  );
});

test('every type-owned CSS entry names a real core type', () => {
  const core = new Set(CORE_SLIDE_TYPE_NAMES);
  for (const type of Object.keys(TYPE_CSS)) {
    assert.ok(
      core.has(type),
      `TYPE_CSS has "${type}" but it is not a registered core type — ` +
        `rename or remove the entry (it would emit a dead @import)`,
    );
  }
});

test('every CSS file on disk is claimed exactly once (no orphans, no drift)', () => {
  for (const tier of TIERS) {
    const dir = aggregatorAbsPath(tier).replace(/\.css$/, '');
    const onDisk = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.css'))
      .sort();
    const claimed = tierEntries(tier.dir)
      .map((e) => e.file)
      .sort();
    assert.deepEqual(
      claimed,
      onDisk,
      `tier ${tier.dir}: the files on disk and the declared imports disagree — ` +
        `a new stylesheet must be declared (on a type via TYPE_CSS, or in SHARED_CSS), ` +
        `and a removed one un-declared`,
    );
  }
});

test('cascade order is unique within each tier (no ambiguous winner)', () => {
  for (const tier of TIERS) {
    const orders = tierEntries(tier.dir).map((e) => e.order);
    assert.equal(
      new Set(orders).size,
      orders.length,
      `tier ${tier.dir}: two imports share a cascade order — the winner is undefined`,
    );
  }
});

test('no CSS file is declared twice (type and shared, or across tiers)', () => {
  const seen = new Map();
  const all = [
    ...typeCssEntries().map((e) => ({ tier: e.tier, file: e.file })),
    ...SHARED_CSS.map((e) => ({ tier: e.tier, file: e.file })),
  ];
  for (const { tier, file } of all) {
    const key = `${tier}/${file}`;
    assert.ok(!seen.has(key), `${key} is declared more than once`);
    seen.set(key, true);
  }
});

test('poll keeps its documented out-of-cascade position after countdown', () => {
  // The one anomaly the manifest encodes explicitly: guard it so a future edit
  // that "tidies" poll back to its filename prefix trips here first.
  const order = tierEntries('03-components');
  const idx = (file) => order.findIndex((e) => e.file === file);
  assert.ok(
    idx('10-poll.css') > idx('18-countdown.css'),
    'poll loads after countdown',
  );
  assert.ok(
    idx('10-poll.css') < idx('20-chart.css'),
    'poll loads before chart',
  );
  assert.equal(cascadeOrder(TYPE_CSS['poll-slide'][0]), 19);
});

test('every viewer-layer file on disk is claimed exactly once (D267)', () => {
  const dir = path.join(REPO_ROOT, 'client', 'styles', VIEWER_LAYER.dir);
  const onDisk = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .sort();
  assert.deepEqual(
    [...viewerEntries()].sort(),
    onDisk,
    'client/styles/viewer/ and VIEWER_LAYER.files disagree: declare a new sheet, un-declare a removed one',
  );
  assert.equal(
    new Set(VIEWER_LAYER.files).size,
    VIEWER_LAYER.files.length,
    'a viewer file is declared twice',
  );
});

test('the viewer layer loads in app.css and export.css only, before slides.css (D267)', () => {
  const importsOf = (file) =>
    [
      ...fs
        .readFileSync(path.join(REPO_ROOT, 'client', 'styles', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .matchAll(/@import url\('\.\/([^']+)'\);/g),
    ].map((m) => m[1]);
  const viewer = VIEWER_LAYER.aggregator;
  // app.css: last, so the chrome keeps its place after the app CSS; the
  // editor page links slides.css after app.css (client/index.html).
  const app = importsOf('app.css');
  assert.equal(app.at(-1), viewer, 'app.css imports viewer.css last');
  // export.css: after the tokens and primitives the chrome reads; the export
  // bundle appends slides.css after export.css (server/export/css-bundle.js).
  const exp = importsOf('export.css');
  assert.ok(
    exp.indexOf(viewer) > exp.indexOf('shared/primitives.css') &&
      exp.indexOf('shared/primitives.css') >= 0,
    'export.css imports viewer.css after shared/primitives.css',
  );
  // The embed iframe and the slide chain carry no presenter shell.
  assert.ok(
    !importsOf('embed.css').includes(viewer),
    'embed.css has no viewer layer',
  );
  assert.ok(
    !importsOf(ROOT_AGGREGATOR).some((p) => p.includes(viewer)),
    'slides.css (and so the MCP preview) has no viewer layer',
  );
});

test('every feature-chrome file is claimed exactly once, each in a feature folder (D267)', () => {
  const appDir = path.join(
    REPO_ROOT,
    'client',
    'styles',
    APP_FEATURE_LAYER.dir,
  );
  const onDisk = fs
    .readdirSync(appDir, { recursive: true })
    .filter((f) => f.endsWith('.css'))
    .map((f) => f.split(path.sep).join('/'));
  // The two files directly in app/ are entry layers, imported by app.css on
  // their own: the app tokens and the editor primitives (D266).
  const loose = onDisk.filter((f) => !f.includes('/')).sort();
  assert.deepEqual(
    loose,
    ['components.css', 'tokens.css'],
    'a feature sheet lives in its feature folder, never loose in client/styles/app/',
  );
  assert.deepEqual(
    [...APP_FEATURE_LAYER.files].sort(),
    onDisk.filter((f) => f.includes('/')).sort(),
    'client/styles/app/<feature>/ and APP_FEATURE_LAYER.files disagree: declare a new sheet, un-declare a removed one',
  );
  assert.equal(
    new Set(APP_FEATURE_LAYER.files).size,
    APP_FEATURE_LAYER.files.length,
    'a feature sheet is declared twice',
  );
  // The folders are the map of client/views/; `shell/` is the app frame
  // around every view (topbar, sidebar, utilities, toasts, banners).
  const views = fs
    .readdirSync(path.join(REPO_ROOT, 'client', 'views'), {
      withFileTypes: true,
    })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const allowed = new Set([...views, 'shell']);
  for (const file of APP_FEATURE_LAYER.files) {
    const feature = file.split('/')[0];
    assert.ok(
      allowed.has(feature),
      `${file}: "${feature}/" is not a folder of client/views/ (or shell/)`,
    );
  }
  assert.ok(
    !fs.existsSync(path.join(REPO_ROOT, 'client', 'styles', 'base')),
    'client/styles/base/ is gone: the feature chrome lives under app/<feature>/',
  );
});
