/**
 * Every AI entry in the client follows `enableAi` (B346, D179).
 *
 * The server has one answer for "AI is off" since B337: an AI route is not
 * mounted, so it answers 404 (`tests/ai-kill-switch.test.js`). D179 gives the
 * client the same single answer: an AI entry is absent from the DOM — not
 * built, not hidden with a style, not greyed out. Every entry reads that from
 * one function, `aiEnabled()` (or its alt-text refinement `aiAltTextEnabled()`)
 * in `client/lib/state/features.js`.
 *
 * This file is the list of those entries, and it is derived, not remembered:
 *
 *  1. The AI routes come from the server's own declarations — every route
 *     table row with `ai: true`, plus the two mounts that sit behind
 *     `flags.enableAi` whole (`/api/ai/*` and `/api/convert*`).
 *  2. Every client module that names one of those routes must sit under an
 *     entry below. A ninth entry — a new button that calls an AI route — fails
 *     here until it is declared with the place that gates it.
 *  3. Every entry's gate file asks `aiEnabled()` / `aiAltTextEnabled()`, and no
 *     client module reads the `enableAi` / `aiAltText` flags itself: one
 *     question, one place that answers it.
 *
 * A source scan cannot prove the gate wraps the right element; the DOM tests
 * at the bottom pin that for the menu, the description modal and the
 * presenter topbar, and the review reads the rest.
 *
 * Run with: node --test tests/ai-entries-follow-enable-ai.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

process.env.AUTH_SECRET = ['deckyard', 'test', 'ai-entries']
  .join('-')
  .padEnd(40, '0');

// ------------------------------------------------------------ the declaration

/**
 * The AI entries of the client. `calls` are the modules that name an AI route;
 * `gate` is the module that decides whether the entry is built.
 */
const AI_ENTRIES = [
  {
    entry: 'Inspector: refine this slide (iterate panel)',
    calls: ['client/views/editor/editor-form/ai-iterate-panel.js'],
    gate: 'client/views/editor/editor-form.js',
  },
  {
    entry: 'Slide menu: AI Convert…',
    calls: ['client/views/editor/editor-form/header-actions.js'],
    gate: 'client/views/editor/editor-form/header-actions.js',
  },
  {
    entry: 'Slide menu: Fill slide… / field: From {lang}',
    calls: [
      'client/views/editor/modals/translate-slide-modal.js',
      'client/views/editor/modals/translate-field-modal.js',
    ],
    gate: 'client/views/editor/editor-controller.js',
  },
  {
    entry: 'Add with AI… (type modal, picker escape hatch, batch review)',
    calls: [
      'client/views/editor/ai-append.js',
      'client/views/editor/modals/ai-batch-review-modal.js',
      'client/lib/net/llm-vendor.js',
    ],
    gate: 'client/views/editor/slides-panel.js',
  },
  {
    entry: 'AI deck review after generation (?aiReview=1)',
    calls: [
      'client/views/editor/modals/ai-deck-review-modal.js',
      'client/views/editor/ai-review-annotations.js',
    ],
    gate: 'client/views/editor/editor-controller.js',
  },
  {
    entry: 'More menu: Analyze',
    calls: ['client/views/editor/modals/analyze-modal.js'],
    gate: 'client/views/editor/editor-controller.js',
  },
  {
    entry: 'More menu: Translate + the new-version translate invite',
    calls: ['client/views/editor/topbar/language-mode.js'],
    gate: 'client/views/editor/topbar/language-mode.js',
  },
  {
    entry: 'Versions: Analyze with AI',
    calls: ['client/views/editor/modals/versions-compare.js'],
    gate: 'client/views/editor/modals/versions-compare.js',
  },
  {
    entry: 'Description: Generate with AI',
    calls: ['client/views/editor/modals/description-modal.js'],
    gate: 'client/views/editor/modals/description-modal.js',
  },
  {
    entry: 'ImageKit picker: Generate ALT',
    calls: ['client/views/editor/imagekit-picker.js'],
    gate: 'client/views/editor/imagekit-picker.js',
  },
  {
    entry: 'Image library: generate alt text',
    calls: [
      'client/views/editor/image-library/detail.js',
      'client/views/editor/image-library/upload.js',
    ],
    gate: 'client/views/editor/image-library/picker.js',
  },
  {
    entry: 'Presenter: follow-along translation fill',
    calls: ['client/views/presenter/translate-fill.js'],
    gate: 'client/views/presenter/index.js',
  },
  {
    entry: 'New presentation: From content (wizard, convert)',
    calls: [
      'client/views/list/modals/new-presentation/handlers.js',
      'client/lib/net/ai-stream.js',
    ],
    gate: 'client/views/list/modals/creation-view/index.js',
  },
];

// ------------------------------------------------------------ the AI routes

const { ROUTES: presentationRoutes } =
  await import('../server/routes/api/presentations/index.js');
const { ROUTES: imageLibraryRoutes } =
  await import('../server/routes/api/image-library.js');
const { ROUTES: convertRoutes } =
  await import('../server/routes/api/convert.js');

/** Whole mounts behind `flags.enableAi` in server/routes/api/index.js. */
const AI_MOUNT_PREFIXES = ['/api/ai/'];
const AI_ROUTE_PATTERNS = [
  ...presentationRoutes.filter((r) => r.ai).map((r) => r.pattern),
  ...imageLibraryRoutes.filter((r) => r.ai).map((r) => r.pattern),
  ...convertRoutes.map((r) => r.pattern),
];

test('the server side of the list is what the kill switch mounts', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'server/routes/api/index.js'),
    'utf8',
  );
  // If either mount stops being gated whole, the prefixes above are wrong.
  assert.match(src, /flags\.enableAi && \(await handleAi\(ctx\)\)/);
  assert.match(src, /flags\.enableAi && \(await handleConvert\(ctx\)\)/);
  assert.ok(AI_ROUTE_PATTERNS.length >= 8, 'no ai: true routes found');
});

/** Does a concrete path (template holes filled with `x`) hit an AI route? */
function isAiPath(p) {
  if (AI_MOUNT_PREFIXES.some((pre) => p.startsWith(pre))) return true;
  return AI_ROUTE_PATTERNS.some((pat) =>
    typeof pat === 'string' ? pat === p : pat.test(p),
  );
}

// ------------------------------------------------------------ the client scan

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const clientFiles = walk(path.join(repoRoot, 'client')).map((f) =>
  path.relative(repoRoot, f).split(path.sep).join('/'),
);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

/** Client modules that name an AI route, mapped to the paths they name. */
function clientAiCallers() {
  const found = new Map();
  // `/api/` anywhere in a literal: `${baseUrl}/api/ai/…` counts too.
  const lit = /[`'"][^`'"\n]*?(\/api\/[^`'"\s]*)[`'"]/g;
  for (const rel of clientFiles) {
    const src = read(rel);
    for (const m of src.matchAll(lit)) {
      const p = m[1].replace(/\$\{[^}]*\}/g, 'x').replace(/\?.*$/, '');
      if (!isAiPath(p)) continue;
      if (!found.has(rel)) found.set(rel, new Set());
      found.get(rel).add(m[1]);
    }
  }
  return found;
}

test('every client module that calls an AI route is a declared entry', () => {
  const declared = new Set(AI_ENTRIES.flatMap((e) => e.calls));
  const callers = clientAiCallers();
  const undeclared = [...callers.keys()].filter((f) => !declared.has(f));
  assert.deepEqual(
    undeclared,
    [],
    'a client module calls an AI route but is not in AI_ENTRIES — declare the ' +
      'entry and gate it on aiEnabled() (D179):\n' +
      undeclared
        .map((f) => `  ${f}: ${[...callers.get(f)].join(', ')}`)
        .join('\n'),
  );
  // And the other way round: a declared caller that no longer calls an AI
  // route is a stale line, not a harmless one.
  const stale = [...declared].filter((f) => !callers.has(f));
  assert.deepEqual(stale, [], 'AI_ENTRIES names modules without an AI call');
});

test('every entry is gated on the one predicate', () => {
  for (const { entry, gate } of AI_ENTRIES) {
    assert.ok(clientFiles.includes(gate), `${entry}: ${gate} does not exist`);
    assert.match(
      read(gate),
      /\bai(AltText)?Enabled\(\)/,
      `${entry}: ${gate} does not ask aiEnabled()`,
    );
  }
});

test('no client module reads the AI flags itself', () => {
  const readers = clientFiles.filter(
    (rel) =>
      rel !== 'client/lib/state/features.js' &&
      /\.(enableAi|aiAltText)\b/.test(read(rel)),
  );
  assert.deepEqual(readers, [], 'read aiEnabled() / aiAltTextEnabled()');
});

// ------------------------------------------------------------ the DOM half

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"></div></body></html>',
  { url: 'http://localhost/app' },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { setFeatures } = await import('../client/lib/state/features.js');
const { createEditorTopbarMoreMenu } =
  await import('../client/views/editor/topbar/more-menu.js');
const { buildPresenterTopbar } =
  await import('../client/views/presenter/topbar.js');

test('More menu: without onTranslateOther there is no Translate item', () => {
  for (const onTranslateOther of [null, () => {}]) {
    const menu = createEditorTopbarMoreMenu({
      root: document.body,
      toast: { info() {}, success() {}, error() {} },
      onTranslateOther,
    });
    const labels = [...menu.el.querySelectorAll('button.dropdown-item')].map(
      (b) => b.textContent.trim(),
    );
    assert.equal(labels.includes('Translate'), !!onTranslateOther);
    assert.ok(!menu.el.textContent.includes('null'));
    menu.detach();
  }
});

test('presenter topbar: a null translate pill leaves no trace', () => {
  const { top } = buildPresenterTopbar({
    pres: { title: 'Deck' },
    langSeg: null,
    translatePill: null,
    interactionPill: null,
    toolsWrap: null,
    autoAdvanceBtn: null,
    laserBtn: null,
    drawBtn: null,
    consoleToggle: null,
    api: async () => ({}),
    getSessionId: () => null,
    onOpenProjector() {},
    onEdit() {},
    onToggleFullscreen() {},
  });
  assert.ok(!top.textContent.includes('null'));
});

test('description modal: Generate with AI exists only where AI does', async () => {
  const { openDescriptionModal } =
    await import('../client/views/editor/modals/description-modal.js');
  for (const enableAi of [false, true]) {
    setFeatures({ enableAi });
    document.body.innerHTML = '';
    const pending = openDescriptionModal({
      root: document.body,
      api: async () => ({}),
      id: 'p1',
      pres: { description: '' },
      toast: { error() {} },
    });
    const labels = [...document.body.querySelectorAll('button')].map((b) =>
      b.textContent.trim(),
    );
    assert.equal(labels.includes('Generate with AI'), enableAi);
    const cancel = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Cancel',
    );
    cancel.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await pending;
  }
  setFeatures(null);
});
