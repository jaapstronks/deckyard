import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadExportCssBundle,
  buildExportStyleContent,
} from '../server/export/css-bundle.js';
import { stripFontFacesFromCss } from '../server/utils/embed-fonts.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

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
  assert.ok(anchorAt !== -1, 'slide font anchor missing from export bundle');

  // The chrome body rule that leaks --ps-font-sans lives in export.css
  // (chromeCss), emitted before the anchor.
  const chromeFontAt = style.indexOf('var(--ps-font-sans)');
  assert.ok(
    chromeFontAt !== -1,
    'sanity: the chrome body font token should still be present in the bundle',
  );
  assert.ok(
    chromeFontAt < anchorAt,
    'the anchor must come after the chrome body font rule it overrides',
  );

  // Derive the slide block's span from the bundle itself rather than a hand-picked
  // marker selector: the anchor has to sit after the WHOLE slides layer, so a
  // future single-class `.slide` rule in slides.css cannot outrank it on order.
  const strippedSlides = stripFontFacesFromCss(bundle.slidesCss);
  const slidesAt = style.indexOf(strippedSlides);
  assert.ok(slidesAt !== -1, 'stripped slides CSS missing from export bundle');
  assert.ok(
    anchorAt >= slidesAt + strippedSlides.length,
    'the anchor must be emitted after the entire slides CSS block, not inside it',
  );
});
