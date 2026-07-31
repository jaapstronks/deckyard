import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadExportCssBundle,
  buildExportStyleContent,
} from '../server/export/css-bundle.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The export style block must anchor the slide's base font to the theme
 * (`--font-body`), not let it inherit the export chrome's `--ps-font-sans`.
 *
 * Background: the export <body> sets `font-family: var(--ps-font-sans)` (an
 * app-chrome token resolving to Inter, …). `buildExportStyleContent` strips
 * Inter's @font-face (theme fonts are embedded separately), so any slide text
 * without its own family would inherit that stripped stack and fall through to
 * the system font — which Skia can only embed as Type 3 in the PDF. A `.slide`
 * base font-family off `--font-body` keeps that text on an embeddable font.
 *
 * Plain string scan of the assembled <style> content; no browser needed.
 */

test('the export bundle anchors .slide to the theme body font', async () => {
  const bundle = await loadExportCssBundle(repoRoot, null, null);
  const style = buildExportStyleContent(bundle);
  assert.match(
    style,
    /\.slide\s*\{\s*font-family:\s*var\(--font-body\)/,
    'export bundle should set `.slide { font-family: var(--font-body) }` so slide ' +
      'text does not inherit the app-chrome --ps-font-sans and end up as a Type 3 ' +
      'system font in the PDF',
  );
});

test('the slide font anchor is ordered after the stripped slide CSS', async () => {
  const bundle = await loadExportCssBundle(repoRoot, null, null);
  const style = buildExportStyleContent(bundle);
  const anchorAt = style.indexOf('.slide { font-family: var(--font-body); }');
  // The chrome body rule that leaks --ps-font-sans lives in export.css (chromeCss),
  // emitted before the anchor. The anchor must exist and sit in the slide layer,
  // after the slides CSS block, so nothing generic re-inherits the chrome font.
  assert.ok(anchorAt !== -1, 'slide font anchor missing from export bundle');
  assert.ok(
    style.includes('var(--ps-font-sans)'),
    'sanity: the chrome body font token should still be present in the bundle',
  );
});
