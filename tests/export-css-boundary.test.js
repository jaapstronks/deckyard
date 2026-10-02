import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadExportCssBundle,
  buildExportStyleContent,
} from '../server/export/css-bundle.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The export CSS boundary (see client/styles/export.css).
 *
 * An exported/rendered deck is a viewer, not the editor. It used to ship the
 * whole of app.css — ~630 KB of editor-only CSS (modals, inspectors, the
 * slide-type picker, settings, analytics) that no exported DOM references. The
 * fix points loadExportCssBundle at export.css, a thin viewer chrome entrypoint.
 *
 * This test is the guard that keeps the boundary honest in both directions:
 * editor chrome must not creep back in, and the handful of viewer selectors the
 * export DOM actually depends on must stay. It is a plain string scan of the
 * assembled <style> content, so it needs no browser.
 */

/** Editor-only selectors that were in the old app.css bundle and must stay out. */
const EDITOR_ONLY = [
  '.user-menu', // app/shell/10-shell-topbar-dropdown.css
  '.ps-type-thumb', // app/editor/70-slide-type-picker.css
  '.inspector-tab', // app/editor/inspector/
  '.editor-advanced', // app/editor/inspector/
  '.slide-type-picker', // app/editor/70-slide-type-picker.css
  '.settings-', // app/settings/
  '.comments-panel', // app/comments/92-comments-panel.css
  '.theme-editor', // app/settings/88-theme-editor.css
];

/** Selectors / tokens the exported deck DOM (html.js, pdf/png/print) needs. */
const VIEWER_NEEDED = [
  '.btn', // deck nav + pdf/png/print toolbars
  '.btn-primary', // pdf/png/print toolbars
  '.btn-secondary', // deck nav
  '.form-input', // png-slides toolbar scale picker
  '.row', // exported presenter topbar
  '.presenter-shell', // viewer.css chrome (D267)
  '.presenter-progress', // viewer.css chrome (D267)
  '.sr-only', // slides.css a11y
  '.skip-link', // slides.css a11y
  '--app-bg-elevated', // ui-tokens.css — presenter chrome reads it unfallbacked
  '--z-skip-link', // ui-tokens.css — skip-link z-index, no fallback
];

test('the export style block carries no editor-only CSS', async () => {
  const bundle = await loadExportCssBundle(repoRoot, null, null, {
    slides: [],
  });
  const style = buildExportStyleContent(bundle);
  for (const sel of EDITOR_ONLY) {
    assert.ok(
      !style.includes(sel),
      `editor-only selector "${sel}" leaked back into the export bundle — ` +
        'loadExportCssBundle should read export.css, not app.css',
    );
  }
});

test('the export style block keeps the viewer chrome the DOM depends on', async () => {
  const bundle = await loadExportCssBundle(repoRoot, null, null, {
    slides: [],
  });
  const style = buildExportStyleContent(bundle);
  for (const sel of VIEWER_NEEDED) {
    assert.ok(
      style.includes(sel),
      `viewer chrome "${sel}" is missing from the export bundle — the exported ` +
        'deck nav/topbar/presenter chrome would break',
    );
  }
});

test('the export chrome CSS stays small (regression ceiling)', async () => {
  const bundle = await loadExportCssBundle(repoRoot, null, null, {
    slides: [],
  });
  // chromeCss is export.css (tokens + button/row chrome), a few KB. The old
  // app.css bundle was ~630 KB. A ceiling well below that catches an accidental
  // re-point at app.css or a large editor import sneaking in via export.css.
  const chromeBytes = Buffer.byteLength(bundle.chromeCss, 'utf8');
  assert.ok(
    chromeBytes < 60 * 1024,
    `export chrome CSS is ${(chromeBytes / 1024).toFixed(1)} KB — expected a ` +
      'thin viewer bundle (<60 KB); a jump this large means editor CSS crept in',
  );
});

test('a theme variant outranks the generic luminance default in exports', async () => {
  // `.slide.slide-bg-<id>` (generated, in themeVarsCss) and
  // `.slide.has-slide-bg-light-text` (00-base.css, in slidesCss) both sit at
  // two-class specificity on the same element, so source order decides which
  // colours a variant slide gets. The variant's authored textColor/linkColor
  // must win — that is what the embed and the client already do, and an export
  // that disagrees is screen/export drift.
  const bundle = await loadExportCssBundle(
    repoRoot,
    {
      id: 'test',
      slideBackgrounds: [
        { id: 'testvariant', value: '#140a26', textColor: '#ffffff' },
      ],
    },
    null,
    { slides: [] },
  );
  const style = buildExportStyleContent(bundle);
  const variantAt = style.indexOf('.slide.slide-bg-testvariant');
  const baseAt = style.indexOf('.slide.has-slide-bg-light-text');
  assert.ok(variantAt > 0, 'the generated variant rule must reach the export');
  assert.ok(baseAt > 0, 'the base luminance rule must reach the export');
  assert.ok(
    variantAt > baseAt,
    'theme vars must be laid down after the slide stylesheets',
  );
});
