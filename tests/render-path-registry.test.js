/**
 * The render-path register is complete, and every entry in it builds.
 *
 * `server/render-paths.js` exists so that "how many ways does Deckyard render a
 * deck?" has a machine-readable answer. That is only worth something if the
 * answer stays true, which is what this file pins:
 *
 *   1. **Shape.** Names are unique and stable, `kind`/`scope` come from the
 *      closed sets, and every `module` really exists on disk.
 *   2. **It builds.** Each path renders a two-slide deck into a document. A
 *      builder whose signature drifted away from `(repoRoot, pres, options)`
 *      fails here rather than in whatever route calls it in production.
 *   3. **Completeness.** Every module under `server/` that emits
 *      `<!doctype html>` is either registered as a render path or listed in
 *      `NON_RENDER_PATH_DOCUMENTS` with a reason. "Neither" is the failure —
 *      that is the state the ninth render path would be born in.
 *
 * What this file deliberately does *not* assert: anything about the CSS chain or
 * the fork seam. Those live in tests/fork-css-seam.test.js, which reads its path
 * list from this same register. One list, two contracts.
 *
 * Run with: node --test tests/render-path-registry.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import {
  RENDER_PATHS,
  RENDER_PATH_KINDS,
  RENDER_PATH_SCOPES,
  NON_RENDER_PATH_DOCUMENTS,
  getRenderPath,
  buildAllRenderPaths,
} from '../server/render-paths.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// The PDF path measures its gradients in a real browser and keeps that instance
// cached for the next caller, so a test file that builds every path has to hand
// it back or the process never exits.
after(closePuppeteerBrowser);

// Deliberately unpronounceable titles: every path inlines tens of thousands of
// lines of core CSS, comments included, so a plausible word like "One" matches
// prose in a stylesheet and the marker proves nothing.
const FIRST = 'Zarquon-slide-marker-1';
const SECOND = 'Zarquon-slide-marker-2';

const DECK = {
  id: 'registry-deck',
  title: 'Registry',
  theme: 'default',
  slides: [
    {
      id: 'slide-1',
      type: 'title-slide',
      content: { title: FIRST, subheading: 'First slide' },
    },
    {
      id: 'slide-2',
      type: 'title-slide',
      content: { title: SECOND, subheading: 'Second slide' },
    },
  ],
};

test('the register is well-formed', async (t) => {
  await t.test('it is not empty', () => {
    assert.ok(RENDER_PATHS.length > 0, 'no render paths are registered');
  });

  await t.test('names are unique', () => {
    const names = RENDER_PATHS.map((p) => p.name);
    assert.deepEqual(
      names.filter((n, i) => names.indexOf(n) !== i),
      [],
      'two render paths share a name — the name is how tests and lint ' +
        'messages address a path, so it has to identify exactly one',
    );
  });

  for (const p of RENDER_PATHS) {
    await t.test(p.name, () => {
      assert.ok(
        RENDER_PATH_KINDS.includes(p.kind),
        `kind "${p.kind}" is not one of ${RENDER_PATH_KINDS.join('/')}`,
      );
      assert.ok(
        RENDER_PATH_SCOPES.includes(p.scope),
        `scope "${p.scope}" is not one of ${RENDER_PATH_SCOPES.join('/')}`,
      );
      assert.equal(typeof p.build, 'function', 'build must be a function');
      assert.ok(
        existsSync(path.join(repoRoot, p.module)),
        `module ${p.module} does not exist`,
      );
      assert.equal(getRenderPath(p.name), p, 'getRenderPath cannot find it');
    });
  }
});

test('every registered path builds a document', async (t) => {
  const documents = await buildAllRenderPaths(repoRoot, DECK);
  assert.equal(
    Object.keys(documents).length,
    RENDER_PATHS.length,
    'buildAllRenderPaths skipped a path',
  );
  for (const p of RENDER_PATHS) {
    await t.test(p.name, () => {
      const html = documents[p.name];
      assert.equal(typeof html, 'string', 'build did not return a string');
      assert.match(
        html,
        /^\s*<!doctype html>/i,
        'a render path returns a complete document, not a fragment',
      );
      assert.match(html, /<html[\s>]/i);
      assert.match(html, /<\/html>/i);
      // Slide 1 is in every path; slide 2 only in the deck-scoped ones. That
      // asymmetry is the `scope` field doing its job, so assert it both ways.
      assert.ok(html.includes(FIRST), 'the first slide did not render');
      assert.equal(
        html.includes(SECOND),
        p.scope === 'deck',
        p.scope === 'deck'
          ? 'a deck-scoped path dropped the second slide'
          : 'a slide-scoped path rendered more than the slide it was given',
      );
    });
  }
});

/**
 * Walk `server/` and collect every module that emits a `<!doctype html>`.
 *
 * Text-level on purpose: the point is to catch a *new* document builder, and a
 * new one is written before anyone thinks about registers. An import-graph walk
 * would only see the ones already wired up.
 *
 * Block comments are stripped first, so a module that merely *writes about* the
 * doctype — this register's own docblock does — is not mistaken for one that
 * emits it.
 */
async function findDocumentEmitters(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'data') continue;
      await findDocumentEmitters(full, acc);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const src = (await readFile(full, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    if (/<!doctype html/i.test(src)) {
      acc.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  }
  return acc;
}

test('every document builder under server/ is accounted for', async () => {
  const emitters = await findDocumentEmitters(path.join(repoRoot, 'server'));
  const registered = new Set(RENDER_PATHS.map((p) => p.module));
  const excused = new Set(Object.keys(NON_RENDER_PATH_DOCUMENTS));

  const unaccounted = emitters
    .filter((m) => !registered.has(m) && !excused.has(m))
    .sort();

  assert.deepEqual(
    unaccounted,
    [],
    'these modules build an HTML document but are neither a registered ' +
      'render path nor listed in NON_RENDER_PATH_DOCUMENTS. If one renders a ' +
      'deck, add it to RENDER_PATHS — a path outside the register misses the ' +
      'fork CSS seam and every other cross-path contract. If it does not, add ' +
      'it to NON_RENDER_PATH_DOCUMENTS with the reason.',
  );

  // The excuse list has to rot in the visible direction: an entry naming a
  // module that no longer emits a document is a stale excuse that would cover
  // for a future file of the same name.
  const staleExcuses = [...excused].filter((m) => !emitters.includes(m)).sort();
  assert.deepEqual(
    staleExcuses,
    [],
    'NON_RENDER_PATH_DOCUMENTS names modules that no longer build a ' +
      'document — drop the entries',
  );

  // Same in the other direction for the register itself.
  const missingModules = RENDER_PATHS.map((p) => p.module)
    .filter((m) => !emitters.includes(m))
    .sort();
  assert.deepEqual(
    missingModules,
    [],
    'a registered render path names a module with no <!doctype html> in it ' +
      '— the register points at the wrong file',
  );
});
