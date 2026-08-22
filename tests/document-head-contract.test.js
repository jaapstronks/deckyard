/**
 * One document opening, and it agrees with itself.
 *
 * `server/utils/head-chain.js` exists because twelve hand-written `<head>`s were
 * twelve chances to forget something, and they took every one: `dir` was set by
 * four paths and dropped by four others, and the embed resolved its language
 * through a second, weaker spelling (`detectLang`) that read only a legacy
 * per-slide heuristic — so a deck declaring `lang: 'ar'` came out as
 * `<html lang="nl" dir="rtl">`, the two attributes contradicting each other
 * inside one tag.
 *
 * Three things are pinned here:
 *
 *   1. **The chain's own contract** — `dir` is derived from `lang`, never
 *      accepted beside it; optional metas are absent rather than blank; the
 *      `<style>` blocks come last, which is what keeps the fork seam last.
 *   2. **The cross-path outcome** — every registered render path answers the
 *      same deck with the same `lang`/`dir`. That is the assertion `detectLang`
 *      would have failed, and the one a thirteenth head would fail again.
 *   3. **The title is the deck's** — no path signs the document with its own
 *      name (D45). Same shape of argument: one `title:` argument per path, so
 *      "which paths decorate it?" is a question the register can answer.
 *
 * Run with: node --test tests/document-head-contract.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDocumentHead } from '../server/utils/head-chain.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import { RENDER_PATHS } from '../server/render-paths.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

after(closePuppeteerBrowser);

test('buildDocumentHead derives dir from lang', () => {
  assert.match(buildDocumentHead({ lang: 'nl' }), /<html lang="nl" dir="ltr">/);
  assert.match(buildDocumentHead({ lang: 'ar' }), /<html lang="ar" dir="rtl">/);
  assert.match(buildDocumentHead({ lang: 'he' }), /<html lang="he" dir="rtl">/);
  assert.match(
    buildDocumentHead({ lang: 'en-GB' }),
    /<html lang="en-GB" dir="ltr">/,
  );
});

test('there is no way to pass a dir that contradicts the lang', () => {
  // The bug this module was written to make unrepresentable: `dir` is not an
  // input. If someone adds one, this assertion is what should stop them.
  const html = buildDocumentHead({ lang: 'ar', dir: 'ltr' });
  assert.match(html, /dir="rtl"/);
  assert.doesNotMatch(html, /dir="ltr"/);
});

test('optional head content is absent, not blank', () => {
  const bare = buildDocumentHead({ lang: 'nl' });
  assert.doesNotMatch(bare, /<title>/);
  assert.doesNotMatch(bare, /name="description"/);
  assert.doesNotMatch(bare, /name="robots"/);
  assert.doesNotMatch(bare, /<link/);
  assert.doesNotMatch(bare, /<style/);
  // Nothing but tags: the old templates left a run of whitespace-only lines
  // where an empty interpolation used to be, in every export they produced.
  for (const line of bare.split('\n')) {
    assert.notEqual(line.trim(), '', 'the head carries a blank line');
  }
});

test('title, description and html attributes are escaped', () => {
  const html = buildDocumentHead({
    lang: 'nl',
    title: 'Q&A <script>',
    description: '"quoted"',
    htmlAttrs: { 'data-theme': 'a"b' },
  });
  assert.match(html, /<title>Q&amp;A &lt;script&gt;<\/title>/);
  assert.match(html, /content="&quot;quoted&quot;"/);
  assert.match(html, /data-theme="a&quot;b"/);
});

test('every <style> block comes after every <link>', () => {
  // The fork seam is inside the last <style>; a stylesheet emitted after it
  // would silently outrank every fork rule (tests/fork-css-seam.test.js).
  const html = buildDocumentHead({
    lang: 'nl',
    head: ['<link rel="stylesheet" href="/from-head.css" />'],
    stylesheets: ['/a.css'],
    styles: [{ id: 'vars', css: ':root{}' }, 'body {\n  margin: 0;\n}'],
  });
  const lastLink = html.lastIndexOf('<link');
  const firstStyle = html.indexOf('<style');
  assert.ok(lastLink > 0 && firstStyle > lastLink);
  assert.ok(html.indexOf('<style id="vars">') < html.indexOf('<style>'));
  // Assembled CSS stays at column zero: indenting a chain would rewrite every
  // line of every export for no gain.
  assert.match(html, / {4}<style>\nbody \{\n {2}margin: 0;\n}\n {4}<\/style>/);
});

test('a pre-indented head fragment keeps its shape', () => {
  // Callers hand in blocks indented to wherever they sit in their own source
  // (buildPrismKatexTags used to hand back four-space-indented tags). The
  // chain owns indentation, so the block is dedented and re-indented as one.
  const html = buildDocumentHead({
    lang: 'nl',
    head: ['\n      <meta name="a" />\n        <meta name="b" />\n    '],
  });
  assert.match(html, /\n {4}<meta name="a" \/>\n {6}<meta name="b" \/>\n/);
});

const DECKS = {
  'pres.lang = ar': { lang: 'ar', expect: { lang: 'ar', dir: 'rtl' } },
  'i18n.active = he': {
    i18n: { active: 'he' },
    expect: { lang: 'he', dir: 'rtl' },
  },
  'i18n.dominant = en-GB': {
    i18n: { dominant: 'en-GB' },
    expect: { lang: 'en-GB', dir: 'ltr' },
  },
  'nothing declared': { expect: { lang: 'nl', dir: 'ltr' } },
};

test('every render path answers one deck with one lang and one dir', async (t) => {
  for (const [label, { expect, ...deckFields }] of Object.entries(DECKS)) {
    await t.test(label, async (t2) => {
      const pres = {
        id: 'head-contract',
        title: 'Head',
        theme: 'default',
        slides: [
          { id: 's1', type: 'title-slide', content: { title: 'Kop' } },
          { id: 's2', type: 'title-slide', content: { title: 'Twee' } },
        ],
        ...deckFields,
      };
      for (const p of RENDER_PATHS) {
        await t2.test(p.name, async () => {
          const html = await p.build(repoRoot, pres, {});
          const open = html.match(/<html\b[^>]*>/)[0];
          assert.ok(
            open.includes(`lang="${expect.lang}"`),
            `${p.name}: expected lang="${expect.lang}", got ${open}`,
          );
          assert.ok(
            open.includes(`dir="${expect.dir}"`),
            `${p.name}: expected dir="${expect.dir}", got ${open}`,
          );
        });
      }
    });
  }
});

/**
 * The paths that emit no `<title>` at all, and why.
 *
 * Both raster a single slide to a PNG: the document is a painting surface, not
 * a page anyone lands on, so there is no tab to name. `buildDocumentHead` omits
 * an empty title rather than emitting a blank one. Held two ways below — an
 * entry that grows a title fails, and so does a path that quietly loses one.
 */
const TITLELESS_PATHS = new Set(['render/png', 'mcp/preview (single)']);

test('a render path titles the document with the deck title, and nothing else', async (t) => {
  // A download's `<title>` is a user-facing artefact: it is what a tab, a
  // bookmark and a "save as" dialog show. Three paths used to sign their own
  // work there — `" (Print)"`, `" (PDF Slides)"`, `" (PNG Export)"` — so the
  // path name leaked into the reader's bookmark bar for no reader's benefit
  // (A7.32/D45). The head chain gives every path one `title:` argument, which
  // is what makes the rule cheap to state and cheap to keep.
  const pres = {
    id: 'head-title',
    title: 'Quarterly Review',
    theme: 'default',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Kop' } }],
  };
  for (const p of RENDER_PATHS) {
    await t.test(p.name, async () => {
      const html = await p.build(repoRoot, pres, {});
      const found = html.match(/<title>([\s\S]*?)<\/title>/);
      if (TITLELESS_PATHS.has(p.name)) {
        assert.equal(
          found,
          null,
          `${p.name}: rasters one slide, so it names no tab`,
        );
        return;
      }
      assert.ok(found, `${p.name}: a page a reader lands on needs a title`);
      assert.equal(
        found[1],
        'Quarterly Review',
        `${p.name}: the deck title, verbatim — no path name appended`,
      );
    });
  }
});

test('a slide-scoped path falls back when no caller supplies docLang', async (t) => {
  // render/png and the single-slide MCP preview raster one slide with no deck
  // around it, so they take `docLang` from whoever has the deck (the register
  // does, in the test above). Called bare they still have to answer something,
  // and that answer is the per-slide legacy heuristic — never a contradiction.
  const slide = {
    id: 's1',
    type: 'title-slide',
    content: { title: 'Kop', lang: 'en' },
  };
  const pres = { title: 'Head', theme: 'default', slides: [slide] };
  for (const p of RENDER_PATHS.filter((x) => x.scope === 'slide')) {
    await t.test(p.name, async () => {
      const html = await p.build(repoRoot, pres, { docLang: '' });
      assert.match(html, /<html lang="en-GB" dir="ltr"/);
    });
  }
});
