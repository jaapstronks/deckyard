/**
 * The composition seam for `title-slide` (B535, D270).
 *
 * A fork that wants core's title layout resolves core's view, sets its own
 * values in it and renders it through `shared/slide-types/core-layouts.js`,
 * instead of copying the renderer. These tests pin the three promises of that
 * seam:
 *
 *  1. core's own `renderHtml` IS the composition, so the seam can never drift
 *     from what core renders;
 *  2. the tracked fork fixture (`fork-title-slide.js`) gets core's `tsu-*`
 *     structure plus its own additions while its source names no `tsu-` class;
 *  3. `renderTitleView` escapes every string in the view, so a fork never has
 *     to;
 *  4. the seam carries what else a fork needs to lend the layout without a
 *     core class name: the inline-edit descriptor, and a view that asks for
 *     no ground class (B636).
 *
 * Runs in the plain core suite: the fixture is imported from a copy (see
 * `tests/helpers/fork-slide-type-fixtures.js`), not from `custom/`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveTitleView,
  renderTitleView,
  titleInlineEdit,
} from '../shared/slide-types/core-layouts.js';
import { inlineEdit as coreTitleInlineEdit } from '../shared/slide-types/types/title-slide/inline-edit.js';
import { CORE_SLIDE_TYPE_DEFS } from '../shared/slide-types/registry.js';
import {
  FORK_FIXTURE_DIR,
  loadForkFixtures,
} from './helpers/fork-slide-type-fixtures.js';

const core = CORE_SLIDE_TYPE_DEFS['title-slide'];
const THEME = {
  titleLayout: 'top',
  assets: { titleLogo: '/theme/title-logo.svg', titleLogoAlt: 'Theme' },
};
const CONTENT = {
  title: 'A title',
  subheading: 'A subtitle',
  meta: 'Someone · 2026',
  titleBlockAlign: 'center',
  logoCorner: 'left',
};

/**
 * The `class` attributes of `html`, in document order.
 * @param {string} html
 * @returns {string[][]}
 */
function classAttrs(html) {
  return [...html.matchAll(/class="([^"]*)"/g)].map((m) =>
    m[1].split(/\s+/).filter(Boolean),
  );
}

async function forkTitle() {
  const fixtures = await loadForkFixtures();
  const found = fixtures.find((f) => f.name === 'fork-title-slide');
  assert.ok(found, 'fork-title-slide.js must be among the fork fixtures');
  return found.def;
}

test("core's renderHtml is resolveTitleView then renderTitleView", () => {
  for (const content of [core.defaults, CONTENT, {}]) {
    for (const theme of [undefined, THEME]) {
      const ctx = { theme };
      assert.equal(
        core.renderHtml(content, {}, ctx),
        renderTitleView(resolveTitleView(content, {}, ctx)),
      );
    }
  }
});

test('the fork fixture names no tsu- class and imports only the seam', () => {
  const src = readFileSync(
    join(FORK_FIXTURE_DIR, 'fork-title-slide.js'),
    'utf8',
  );
  assert.doesNotMatch(src, /tsu-/);
  const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(specifiers, ['../../shared/slide-types/core-layouts.js']);
});

test("the fork fixture renders core's tsu- structure plus its own additions", async () => {
  const fork = await forkTitle();
  const ctx = { theme: THEME };
  const forkHtml = fork.renderHtml({ ...CONTENT, frame: 'panel' }, {}, ctx);
  const coreHtml = core.renderHtml(CONTENT, {}, ctx);

  const forkAttrs = classAttrs(forkHtml);
  const coreAttrs = classAttrs(coreHtml);
  // Same elements in the same order; only the root differs, by additions.
  assert.equal(forkAttrs.length, coreAttrs.length);
  assert.deepEqual(forkAttrs.slice(1), coreAttrs.slice(1));
  const [forkRoot, coreRoot] = [forkAttrs[0], coreAttrs[0]];
  for (const name of coreRoot) assert.ok(forkRoot.includes(name), name);
  assert.deepEqual(
    forkRoot.filter((name) => !coreRoot.includes(name)),
    ['slide-fork-title', 'is-fork-panel'],
  );
  assert.ok(forkRoot.includes('slide-title'), 'core root lends the layout');
  assert.ok(
    forkAttrs.flat().some((name) => name.startsWith('tsu-')),
    'the fork markup carries the tsu- structure',
  );

  // Its own logo replaces the theme's; every other value is core's.
  assert.match(forkHtml, /src="\/custom\/assets\/fork-title-logo\.svg"/);
  assert.doesNotMatch(forkHtml, /title-logo\.svg" alt="Theme"/);
  assert.equal(
    forkHtml
      .replace(/ slide-fork-title is-fork-panel/, '')
      .replace(
        'src="/custom/assets/fork-title-logo.svg" alt="Fork"',
        'src="/theme/title-logo.svg" alt="Theme"',
      ),
    coreHtml,
  );

  // The modifier follows the fork's own option.
  const open = fork.renderHtml({ ...CONTENT, frame: 'open' }, {}, ctx);
  assert.doesNotMatch(open, /is-fork-panel/);
});

test('renderTitleView escapes every string in the view', () => {
  const evil = '<script>alert(1)</script>"\'&';
  const view = {
    ...resolveTitleView({}, {}, {}),
    title: evil,
    subheading: evil,
    meta: evil,
    classes: [`x"><script>`],
    styleVars: { '--fork-x': `1"><script>` },
    bgImage: { src: `/a.jpg"><script>`, alt: evil },
    logo: { src: `/l.svg" onerror="x`, alt: evil },
  };
  const html = renderTitleView(view);
  // String checks, not a tag regexp: this is an assertion on escaped output,
  // not an HTML filter (CodeQL's bad-tag-filter reads a `/<script>/` as one).
  assert.equal(html.includes('<script'), false, 'no raw tag survives');
  assert.equal(html.includes(evil), false, 'no raw view string survives');
  assert.equal(html.includes('onerror="'), false);
  assert.equal(
    html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#039;&amp;/g)
      ?.length,
    5,
    'title, subtitle, meta, background alt and logo alt, all escaped',
  );
});

test('content text reaching the view is escaped on the core path too', () => {
  const html = core.renderHtml(
    { title: '<b>T</b>', subheading: 'S & "s"', meta: "M'm" },
    {},
    {},
  );
  assert.match(html, /&lt;b&gt;T&lt;\/b&gt;/);
  assert.match(html, /S &amp; &quot;s&quot;/);
  assert.match(html, /M&#039;m/);
});

test("the seam exports title-slide's inline descriptor and the fork uses it", async () => {
  assert.equal(titleInlineEdit, coreTitleInlineEdit);
  const fork = await forkTitle();
  assert.equal(fork.inline, titleInlineEdit);
});

test('a view with background null renders no slide-bg class', async () => {
  const view = { ...resolveTitleView(CONTENT, {}, {}), background: null };
  const [root] = classAttrs(renderTitleView(view));
  assert.ok(root.includes('slide-title'));
  assert.equal(
    root.some((name) => name.startsWith('slide-bg-')),
    false,
    root.join(' '),
  );

  // Core never resolves to null: empty and unknown grounds still fall back.
  for (const background of [undefined, '', 'mist']) {
    const [coreRoot] = classAttrs(
      core.renderHtml({ ...CONTENT, background }, {}, {}),
    );
    assert.ok(
      coreRoot.some((name) => name.startsWith('slide-bg-')),
      String(background),
    );
  }

  const fork = await forkTitle();
  const [bare] = classAttrs(
    fork.renderHtml({ ...CONTENT, background: 'transparent' }, {}, {}),
  );
  assert.equal(
    bare.some((name) => name.startsWith('slide-bg-')),
    false,
  );
  const [painted] = classAttrs(
    fork.renderHtml({ ...CONTENT, background: 'mist' }, {}, {}),
  );
  assert.ok(painted.includes('slide-bg-mist'));
});
