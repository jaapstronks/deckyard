/**
 * Every client entry of an installation cluster follows its flag (B346, D179,
 * D260; generalised from the AI-only gate in B522).
 *
 * The server has one answer for "cluster off" since B522 (D257): a mount or
 * row with that `feature` is not mounted, so it answers 404
 * (`tests/ai-kill-switch.test.js`, `tests/feature-declarations.test.js`).
 * D179/D260 give the client the same single answer: the entry is absent from
 * the DOM — not built, not hidden with a style, not greyed out. Every entry
 * reads that from one function, `featureEnabled(key)` (for AI also its
 * alt-text refinement `aiAltTextEnabled()`) in `client/lib/state/features.js`.
 *
 * This file is the list of those entries per cluster, and the cluster's
 * routes are derived, not remembered:
 *
 *  1. A cluster's routes come from the server's own declarations — every row
 *     of a module whose mount carries the `feature` in
 *     `server/routes/api/index.js`, plus every row that carries it itself.
 *  2. Every client module that names one of those routes must sit under an
 *     entry of that cluster. A new button that calls such a route fails here
 *     until it is declared with the place that gates it.
 *  3. Every entry's gate file asks `featureEnabled('<key>')`, and no client
 *     module reads the `enable<Key>` flag itself: one question, one place
 *     that answers it.
 *
 * A cluster joins this file when it gets a client entry (B581 uploads; B523
 * analytics, B524 live, B525 stock media and the public API add theirs).
 *
 * A source scan cannot prove the gate wraps the right element; the DOM tests
 * at the bottom pin that for the menu, the description modal and the
 * presenter topbar, and the review reads the rest.
 *
 * Run with: node --test tests/feature-entries-follow-flags.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

process.env.AUTH_SECRET = ['deckyard', 'test', 'feature-entries']
  .join('-')
  .padEnd(40, '0');

// ------------------------------------------------------------ the declaration

/**
 * The client entries per cluster. `calls` are the modules that name one of
 * the cluster's routes; `gate` is the module that decides whether the entry
 * is built.
 */
const ENTRIES = {
  ai: [
    {
      entry: 'Inspector: refine this slide (iterate panel)',
      calls: ['client/views/editor/editor-form/ai-iterate-panel.js'],
      gate: 'client/views/editor/editor-form/index.js',
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
      calls: ['client/views/editor/imagekit-picker/index.js'],
      gate: 'client/views/editor/imagekit-picker/index.js',
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
      entry: 'New presentation: From content (wizard, convert, Notion import)',
      calls: [
        'client/views/list/modals/new-presentation/handlers.js',
        'client/lib/net/ai-stream.js',
      ],
      gate: 'client/views/list/modals/creation-view/index.js',
    },
  ],
  notion: [
    {
      entry: 'New presentation: the Notion sub-tab (import)',
      calls: [
        'client/views/list/modals/creation-view/content-compose.js',
        'client/views/list/modals/new-presentation/handlers.js',
      ],
      gate: 'client/views/list/modals/creation-view/content-compose.js',
    },
    {
      entry: 'Share: Publish to Notion',
      calls: [
        'client/views/editor/share-dropdown/index.js',
        'client/views/editor/share-dropdown/share-actions.js',
      ],
      gate: 'client/views/editor/share-dropdown/index.js',
    },
  ],
  // D295: installation-off is absent like every cluster; only `sandboxMode`
  // beside the key greys an entry out (D181). The direct route from an image
  // field and the inline editor's drop target reach `/api/uploads` through
  // the library's `upload.js`, so their gates are listed with that entry.
  uploads: [
    {
      entry: 'Image library: the upload panel',
      calls: ['client/views/editor/image-library/upload.js'],
      gate: 'client/views/editor/image-library/picker.js',
    },
    {
      entry: 'Image fields: Upload from computer (the picker seam)',
      calls: ['client/views/editor/image-library/upload.js'],
      gate: 'client/views/editor/media/picker-provider.js',
    },
    {
      entry: 'Inline editor: drop an image file on the canvas',
      calls: ['client/views/editor/image-library/upload.js'],
      gate: 'client/views/editor/editor-controller.js',
    },
    {
      entry: 'Theme editor: logo dropzone',
      calls: ['client/views/settings/theme-editor/upload-image.js'],
      gate: 'client/views/settings/theme-editor/logo-uploader.js',
    },
    {
      entry: 'Theme editor: add background images',
      calls: ['client/views/settings/theme-editor/upload-image.js'],
      gate: 'client/views/settings/theme-editor/backgrounds-section.js',
    },
  ],
};

/** The predicate an entry's gate must ask, per cluster. */
const GATE = {
  ai: /\bfeatureEnabled\('ai'\)|\baiAltTextEnabled\(\)/,
  notion: /\bfeatureEnabled\('notion'\)/,
  uploads: /\bfeatureEnabled\('uploads'\)/,
};

/** The snapshot keys only `client/lib/state/features.js` may read. */
const FLAG_READ = /\.(enableAi|aiAltText|enableNotion|enableUploads)\b/;

// ------------------------------------------------------------ the server side

const { MOUNTS } = await import('../server/routes/api/index.js');
const { ROUTES: presentationRoutes } =
  await import('../server/routes/api/presentations/index.js');
const { ROUTES: imageLibraryRoutes } =
  await import('../server/routes/api/image-library.js');
const { ROUTES: aiRoutes, handleAi } =
  await import('../server/routes/api/ai/index.js');
const { ROUTES: convertRoutes, handleConvert } =
  await import('../server/routes/api/convert.js');
const { ROUTES: notionRoutes, handleNotion } =
  await import('../server/routes/api/notion/index.js');
const { ROUTES: uploadRoutes, handleUploads } =
  await import('../server/routes/api/uploads.js');

/**
 * Each mount handle under a cluster, with the table it dispatches. A mount
 * that gains or loses a `feature` fails the pin below until this map follows.
 */
const MOUNT_TABLES = {
  ai: [
    [handleAi, aiRoutes],
    [handleConvert, convertRoutes],
  ],
  notion: [[handleNotion, notionRoutes]],
  uploads: [[handleUploads, uploadRoutes]],
};

/** Tables whose rows may carry a `feature` of their own. */
const ROW_TABLES = [presentationRoutes, imageLibraryRoutes, notionRoutes];

/** Every route pattern of a cluster: its mounted tables plus its own rows. */
function clusterPatterns(key) {
  return [
    ...MOUNT_TABLES[key].flatMap(([, table]) => table.map((r) => r.pattern)),
    ...ROW_TABLES.flatMap((table) =>
      table.filter((r) => r.feature === key).map((r) => r.pattern),
    ),
  ];
}

test('the mounted tables are exactly the mounts that carry the feature', () => {
  for (const key of Object.keys(ENTRIES)) {
    assert.deepEqual(
      MOUNTS.filter((m) => m.feature === key).map((m) => m.handle),
      MOUNT_TABLES[key].map(([handle]) => handle),
      `MOUNTS under '${key}' disagree with MOUNT_TABLES`,
    );
  }
  assert.ok(clusterPatterns('ai').length >= 8, 'no ai routes found');
});

/** Does a concrete path (template holes filled with `x`) hit one of `patterns`? */
function hits(patterns, p) {
  return patterns.some((pat) =>
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

/** Client modules that name one of `patterns`, mapped to the paths they name. */
function clientCallers(patterns) {
  const found = new Map();
  // `/api/` anywhere in a literal: `${baseUrl}/api/ai/…` counts too.
  const lit = /[`'"][^`'"\n]*?(\/api\/[^`'"\s]*)[`'"]/g;
  for (const rel of clientFiles) {
    const src = read(rel);
    for (const m of src.matchAll(lit)) {
      const p = m[1].replace(/\$\{[^}]*\}/g, 'x').replace(/\?.*$/, '');
      if (!hits(patterns, p)) continue;
      if (!found.has(rel)) found.set(rel, new Set());
      found.get(rel).add(m[1]);
    }
  }
  return found;
}

for (const [key, entries] of Object.entries(ENTRIES)) {
  test(`${key}: every client module that calls the cluster is a declared entry`, () => {
    const declared = new Set(entries.flatMap((e) => e.calls));
    const callers = clientCallers(clusterPatterns(key));
    const undeclared = [...callers.keys()].filter((f) => !declared.has(f));
    assert.deepEqual(
      undeclared,
      [],
      `a client module calls a '${key}' route but is not in ENTRIES.${key} — ` +
        `declare the entry and gate it on featureEnabled('${key}') (D179):\n` +
        undeclared
          .map((f) => `  ${f}: ${[...callers.get(f)].join(', ')}`)
          .join('\n'),
    );
    // And the other way round: a declared caller that no longer calls the
    // cluster is a stale line, not a harmless one.
    const stale = [...declared].filter((f) => !callers.has(f));
    assert.deepEqual(stale, [], `ENTRIES.${key} names modules without a call`);
  });

  test(`${key}: every entry is gated on the one predicate`, () => {
    for (const { entry, gate } of entries) {
      assert.ok(clientFiles.includes(gate), `${entry}: ${gate} does not exist`);
      assert.match(
        read(gate),
        GATE[key],
        `${entry}: ${gate} does not ask featureEnabled('${key}')`,
      );
    }
  });
}

test('no client module reads a cluster flag itself', () => {
  const readers = clientFiles.filter(
    (rel) =>
      rel !== 'client/lib/state/features.js' && FLAG_READ.test(read(rel)),
  );
  assert.deepEqual(
    readers,
    [],
    'read featureEnabled(key) / aiAltTextEnabled()',
  );
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

test('uploads: off is absent, only the sandbox greys out (D295)', async () => {
  const { createFieldImage } =
    await import('../client/views/editor/fields/images/single-image.js');
  const { createImageLibraryUpload } =
    await import('../client/views/editor/image-library/upload.js');
  const openImagePicker = () => {};
  openImagePicker.providers = ['library'];
  openImagePicker.upload = null;

  for (const [features, expect] of [
    [{ enableUploads: true }, 'or upload your own image'],
    [{ enableUploads: false, sandboxMode: true }, 'off in the sandbox'],
    [{ enableUploads: false }, null],
  ]) {
    setFeatures(features);
    const field = createFieldImage({ openImagePicker, pres: { id: 'p1' } })(
      { id: 's1', type: 'image', content: {} },
      { key: 'image' },
      () => {},
    );
    const text = field.textContent;
    assert.ok(!text.includes('null'), 'no stray null in the field');
    assert.ok(!text.includes('Uploads are disabled'));
    if (expect) assert.ok(text.includes(expect), `${expect} in ${text}`);
    else assert.ok(!/upload/i.test(text), `no upload copy in: ${text}`);

    const panel = createImageLibraryUpload({
      user: { email: 'a@b.c' },
      items: () => [],
      uploadsEnabled: features.enableUploads,
    });
    if (features.enableUploads)
      assert.ok(panel.el.querySelector('.image-lib-dropzone'));
    else if (features.sandboxMode)
      assert.ok(panel.el.textContent.includes('off in the sandbox'));
    else assert.equal(panel.el.childElementCount, 0);
  }
  setFeatures(null);
});
